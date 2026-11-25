/**
 * Operate the develop parity loop for one pull request: route review to the agent,
 * and merge once every review is resolved.
 *
 * Reads on every relevant event, writes only what the read justifies:
 *  - `request-review`  a review request for the reviewer when none is outstanding
 *  - `merge`           a squash merge of an approved, unblocked pull request
 *
 * Every decision is pure and lives in `policy.mjs`, which its test exercises.
 */
import fs from 'node:fs'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import {
  autoMergeBlockers,
  baseBranchError,
  latestVerdicts,
  needsReviewRequest,
  REVIEWER,
} from './policy.mjs'

/** Run one `gh api` call and parse its JSON body. */
function api(path, { method = 'GET', body } = {}) {
  const args = ['api', path]
  if (method !== 'GET') args.push('-X', method)
  if (body !== undefined) args.push('--input', '-')
  const output = execFileSync('gh', args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return output.trim() === '' ? null : JSON.parse(output)
}

/** Count review threads GitHub still reports as unresolved. */
function unresolvedThreads(repository, number) {
  const query = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { isResolved }
        }
      }
    }
  }`
  const [owner, name] = repository.split('/')
  let after
  let unresolved = 0
  for (;;) {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${String(number)}`]
    if (after !== undefined) args.push('-F', `after=${after}`)
    const result = execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const threads = JSON.parse(result).data.repository.pullRequest.reviewThreads
    unresolved += threads.nodes.filter(node => !node.isResolved).length
    if (!threads.pageInfo.hasNextPage) return unresolved
    after = threads.pageInfo.endCursor
  }
}

/** Request the reviewer when the pull request has none outstanding. */
function requestReview(repository, number, pull) {
  const reviews = api(`repos/${repository}/pulls/${number}/reviews?per_page=100`)
  const verdicts = latestVerdicts(reviews)
  const requested = (pull.requested_reviewers ?? []).map(user => user.login)
  // A dismissal means the code moved under the reviewer's verdict, so ask again.
  const dismissed = reviews.some(review => review.user?.login === REVIEWER && review.state?.toUpperCase() === 'DISMISSED')
  if (!needsReviewRequest({ requested, reviewed: verdicts.reviewed, dismissed })) {
    process.stdout.write('Review already routed to the reviewer.\n')
    return
  }
  api(`repos/${repository}/pulls/${number}/requested_reviewers`, {
    method: 'POST',
    body: { reviewers: [REVIEWER] },
  })
  process.stdout.write(`Requested review from @${REVIEWER}.\n`)
}

/** Merge when the pure decision finds nothing outstanding. */
function mergeIfApproved(repository, number, pull) {
  const reviews = api(`repos/${repository}/pulls/${number}/reviews?per_page=100`)
  const verdicts = latestVerdicts(reviews)
  const blockers = autoMergeBlockers({
    base: pull.base.ref,
    isDraft: pull.draft,
    state: pull.state,
    approved: verdicts.approved,
    changesRequested: verdicts.changesRequested,
    unresolvedThreads: unresolvedThreads(repository, number),
    mergeStateStatus: pull.mergeable_state ?? 'unknown',
  })
  if (blockers.length > 0) {
    process.stdout.write(`Not merging:\n${blockers.map(reason => `  - ${reason}`).join('\n')}\n`)
    return
  }
  api(`repos/${repository}/pulls/${number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash' },
  })
  process.stdout.write(`Merged #${number} into ${pull.base.ref}.\n`)
}

function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const pull = event.pull_request
  const repository = event.repository.full_name
  const number = pull.number

  const baseError = baseBranchError(pull.base.ref)
  if (baseError !== null) {
    process.stdout.write(`::error::${baseError}\n`)
    return
  }
  // A closed or merged pull request has nothing left to route or merge.
  if (pull.state !== 'open') {
    process.stdout.write(`#${number} is ${pull.state}; nothing to do.\n`)
    return
  }
  requestReview(repository, number, pull)
  mergeIfApproved(repository, number, pull)
}

main()
