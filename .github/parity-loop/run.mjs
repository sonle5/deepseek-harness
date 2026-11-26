/**
 * Operate the develop parity loop for one pull request: route review to the agent,
 * and hand the merge to GitHub once the branch's protection is satisfied.
 *
 * Reads on every relevant event, writes only what the read justifies:
 *  - `request-review`  a review request for the reviewer when none is outstanding
 *  - `auto-merge`      GitHub's auto-merge, enabled on a mergeable PR into a protected base
 *
 * The loop never calls the merge endpoint. GitHub applies the branch's
 * protection — one approving review from someone other than the author,
 * dismissal of stale approvals on push, and the required checks — against the
 * commit it is about to merge. That is what makes "the head commit was
 * approved" enforceable rather than a race between this script's reads and its
 * write.
 *
 * Every decision is pure and lives in `policy.mjs`, which its test exercises.
 */
import fs from 'node:fs'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import {
  autoMergeAlreadyEnabled,
  autoMergeBlockers,
  baseBranchError,
  latestVerdicts,
  needsReviewRequest,
  REVIEWER,
} from './policy.mjs'

/** Upper bound on a mergeability read that GitHub has not finished computing. */
const MERGEABILITY_ATTEMPTS = 5

/**
 * Run one `gh api` invocation, retrying transient upstream failures.
 *
 * GitHub answers 502/503 and occasionally truncates a body during an incident.
 * A review gate that dies on one of those has not decided anything, so retry a
 * few times with a short backoff before giving up.
 * @param {string[]} args `gh` arguments.
 * @param {{input?: string}} [options] Standard input.
 * @returns {string} Command output.
 */
function gh(args, { input } = {}) {
  const attempts = 4
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('gh', args, {
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
      const transient = /HTTP 5\d\d|Server Error|unexpected end of JSON input|Bad Gateway/i.test(output)
      if (!transient || attempt === attempts) throw error
      execFileSync('sleep', [String(attempt * 3)], { stdio: 'ignore' })
    }
  }
}

/**
 * Run one `gh api` call and parse its JSON body.
 * @param {string} path API path.
 * @param {{method?: string, body?: unknown}} [options] Request method and JSON body.
 * @returns {any} Parsed response, or null for an empty body.
 */
function api(path, { method = 'GET', body } = {}) {
  const args = ['api', path]
  if (method !== 'GET') args.push('-X', method)
  if (body !== undefined) args.push('--input', '-')
  const output = gh(args, { input: body === undefined ? undefined : JSON.stringify(body) })
  return output.trim() === '' ? null : JSON.parse(output)
}

/**
 * Run one `gh api` call, returning `null` instead of throwing on a 4xx.
 *
 * Used where a failure is an expected outcome rather than an error — a review
 * request GitHub refuses, for instance.
 * @param {string} path API path.
 * @param {{method?: string, body?: unknown}} [options] Request method and JSON body.
 * @returns {any} Parsed response, or null when the call failed.
 */
function apiOrNull(path, options) {
  try {
    return api(path, options)
  } catch {
    return null
  }
}

/**
 * Re-read the pull request until GitHub has computed its mergeability.
 *
 * The event payload carries `mergeable` from before the push that fired it, and
 * REST reports `null` while a check is pending. Both mean "not yet known".
 * @param {string} repository `owner/name`.
 * @param {number} number Pull-request number.
 * @returns {Promise<object>} Fresh pull-request state.
 */
async function freshPull(repository, number) {
  for (let attempt = 1; ; attempt += 1) {
    const pull = api(`repos/${repository}/pulls/${number}`)
    if (pull.mergeable !== null || attempt === MERGEABILITY_ATTEMPTS) return pull
    await new Promise(resolve => { setTimeout(resolve, attempt * 2000) })
  }
}

/**
 * Run one `gh api graphql` call and return its `data`.
 *
 * Auto-merge has no REST endpoint, and classic branch protection cannot be read
 * over REST by a workflow token — `GET /branches/{branch}/protection` wants
 * Administration. GraphQL serves both under the pull-requests scope.
 * @param {string} query GraphQL document.
 * @param {Record<string, string|number>} variables Typed variables.
 * @returns {any} The response's `data` object.
 */
function graphql(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(variables)) {
    // `-F` coerces its value to a JSON type, `-f` always sends a string. Only
    // `number` is an Int here; everything else is a string scalar, and coercing
    // an all-digit commit sha into a number would be rejected by the schema.
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
  }
  let output
  try {
    output = gh(args)
  } catch (error) {
    // `gh` exits non-zero on a GraphQL error but still prints the body to
    // stdout. Lift the real message out of it: the caller matches on it, and
    // "Command failed: gh api graphql ..." says nothing useful.
    const body = `${error.stdout ?? ''}`.trim()
    if (body.startsWith('{')) {
      let errors = []
      try {
        errors = JSON.parse(body).errors ?? []
      } catch (_notJson) { /* A body starting with `{` can still be a non-JSON
        message, and that failure is expected here: the original `gh` error is
        rethrown below and carries the real message. */ }
      if (errors.length > 0) throw new Error(`GraphQL: ${errors.map(item => item.message).join('; ')}`)
    }
    throw error
  }
  const parsed = JSON.parse(output)
  const errors = parsed.errors ?? []
  if (errors.length > 0) throw new Error(`GraphQL: ${errors.map(item => item.message).join('; ')}`)
  return parsed.data
}

/** The base branch's review decision, which is what auto-merge waits on. */
const REVIEW_STATE_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      headRefOid
      reviewDecision
    }
  }
}`

/**
 * Read the pull request's node id, head commit and review decision.
 *
 * `reviewDecision` rather than `baseRef.branchProtectionRule`: the rule is
 * admin-only data, and a token without Administration gets `null` for it
 * rather than an error — so a workflow token cannot tell "no protection" from
 * "protected, but I may not see the rule", and the gate silently reports every
 * branch as unprotected. `reviewDecision` is computed by GitHub from the
 * protection and the current reviews, and a write token can read it:
 * `REVIEW_REQUIRED` and `CHANGES_REQUESTED` both mean review is required,
 * while `null` means no rule asks for one (an unprotected base, or one whose
 * rule no longer requires review).
 * @param {string} repository `owner/name`.
 * @param {number} number Pull-request number.
 * @returns {{id: string, headRefOid: string, reviewDecision: string|null}} Merge target.
 */
function readReviewState(repository, number) {
  const [owner, name] = repository.split('/')
  const pull = graphql(REVIEW_STATE_QUERY, { owner, name, number })?.repository?.pullRequest
  if (pull === null || pull === undefined) throw new Error(`pull request #${number} is not in ${repository}`)
  return { id: pull.id, headRefOid: pull.headRefOid, reviewDecision: pull.reviewDecision ?? null }
}

/** Enable auto-merge on one commit, so a later push needs a fresh run. */
const ENABLE_AUTO_MERGE = `
mutation($pullRequestId: ID!, $headOid: GitObjectID!) {
  enablePullRequestAutoMerge(input: {
    pullRequestId: $pullRequestId
    mergeMethod: SQUASH
    expectedHeadOid: $headOid
  }) {
    pullRequest { number autoMergeRequest { enabledAt } }
  }
}`

/**
 * Whether the base branch is protected at all.
 *
 * `branches/{branch}.protected` is readable with a write token, unlike the
 * protection rule itself. `null` means the call failed — a different fact from
 * `false`, and one the caller reports separately.
 * @param {string} repository `owner/name`.
 * @param {string} base Base branch name.
 * @returns {boolean|null} True or false when read, null when it could not be.
 */
function branchIsProtected(repository, base) {
  try {
    const branch = api(`repos/${repository}/branches/${encodeURIComponent(base)}`)
    return branch?.protected === true
  } catch {
    return null
  }
}

/** Request the reviewer when the pull request has none outstanding. */
function requestReview(repository, number, author) {
  const reviews = api(`repos/${repository}/pulls/${number}/reviews?per_page=100`)
  const verdicts = latestVerdicts(reviews)
  // Read the outstanding requests rather than trusting the event payload, which
  // is a snapshot: a `synchronize` event still carries the reviewers as they
  // were, and asking again is a no-op only by luck.
  const outstanding = api(`repos/${repository}/pulls/${number}/requested_reviewers`)
  const requested = [...(outstanding.users ?? []), ...(outstanding.teams ?? [])].map(user => user.login ?? user.slug)
  if (!needsReviewRequest({
    requested,
    reviewed: verdicts.reviewed,
    latestDismissed: verdicts.latestDismissed,
    authoredByReviewer: author === REVIEWER,
  })) {
    process.stdout.write(author === REVIEWER
      ? `#${number} is authored by @${REVIEWER}; leaving review to a human.\n`
      : 'Review already routed to the reviewer.\n')
    return
  }
  // A reviewer GitHub will not request is a configuration problem the auto-merge
  // gate will surface; do not fail the run here.
  const created = apiOrNull(`repos/${repository}/pulls/${number}/requested_reviewers`, {
    method: 'POST',
    body: { reviewers: [REVIEWER] },
  })
  process.stdout.write(created === null
    ? `::warning::Requesting review from @${REVIEWER} failed; auto-merge stays blocked.\n`
    : `Requested review from @${REVIEWER}.\n`)
}

/** Enable GitHub's auto-merge when the pure decision finds nothing blocking. */
async function enableAutoMerge(repository, number) {
  const pull = await freshPull(repository, number)
  // Both facts come from reads a write token can make. Auto-merge has no REST
  // endpoint at all, and the protection *rule* is admin-only data that reads as
  // null — silently, not as an error — for a workflow token.
  const reviewState = readReviewState(repository, number)
  // `reviewDecision` is only computed while a review rule applies, so `null`
  // means GitHub sees no rule asking for review. That is the branch setting
  // this gate refuses to auto-merge on — distinct from failing to read it,
  // which `readReviewState` throws on and so never reaches here.
  const blockers = autoMergeBlockers({
    base: pull.base.ref,
    isDraft: pull.draft,
    state: pull.state,
    mergeable: pull.mergeable,
    protectedBranch: branchIsProtected(repository, pull.base.ref),
    reviewDecision: reviewState.reviewDecision,
  })
  if (blockers.length > 0) {
    process.stdout.write(`Not enabling auto-merge:\n${blockers.map(reason => `  - ${reason}`).join('\n')}\n`)
    return
  }
  try {
    graphql(ENABLE_AUTO_MERGE, { pullRequestId: reviewState.id, headOid: reviewState.headRefOid })
  } catch (error) {
    // Already enabled is not a failure: `synchronize` re-runs this on every push.
    // Anything else is a real error, and a merge gate that hides it would leave
    // the pull request waiting forever with a green run.
    if (autoMergeAlreadyEnabled(error)) {
      process.stdout.write(`Auto-merge already enabled on #${number}.\n`)
      return
    }
    throw error
  }
  process.stdout.write(`Auto-merge enabled on #${number}; GitHub merges when review and checks allow.\n`)
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const pull = event.pull_request
  const repository = event.repository?.full_name ?? process.env.GITHUB_REPOSITORY
  const number = pull.number

  if (!repository) {
    process.stdout.write('::error::No repository in the event or GITHUB_REPOSITORY.\n')
    return
  }

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
  requestReview(repository, number, pull.user?.login)
  await enableAutoMerge(repository, number)
}

await main()
