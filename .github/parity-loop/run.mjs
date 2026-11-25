/**
 * Operate the develop parity loop for one pull request: route review to the agent,
 * and hand the merge to GitHub once the branch's protection is satisfied.
 *
 * Reads on every relevant event, writes only what the read justifies:
 *  - `request-review`  a review request for the reviewer when none is outstanding
 *  - `auto-merge`      GitHub's auto-merge, enabled on a mergeable PR into a protected base
 *
 * The loop never calls the merge endpoint. GitHub applies the branch's
 * protection — a required approval from the reviewer, dismissal of stale
 * approvals on push, and the required checks — against the commit it is about
 * to merge. That is what makes "approved the head commit" enforceable rather
 * than a race between this script's reads and its write.
 *
 * Every decision is pure and lives in `policy.mjs`, which its test exercises.
 */
import fs from 'node:fs'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { autoMergeBlockers, baseBranchError, latestVerdicts, needsReviewRequest, REVIEWER } from './policy.mjs'

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
 * Whether the base branch enforces review, which is what auto-merge waits on.
 * @param {string} repository `owner/name`.
 * @param {string} base Base branch name.
 * @returns {boolean} True when the branch has protection or a ruleset with required review.
 */
function baseEnforcesReview(repository, base) {
  const protection = apiOrNull(`repos/${repository}/branches/${encodeURIComponent(base)}/protection`)
  if (protection?.required_pull_request_reviews !== undefined) return true
  // A ruleset can require review instead of classic protection.
  const rulesets = apiOrNull(`repos/${repository}/rulesets?includes_parents=true`)
  if (!Array.isArray(rulesets)) return false
  for (const summary of rulesets) {
    if (summary.target !== undefined && summary.target !== 'branch') continue
    const ruleset = apiOrNull(`repos/${repository}/rulesets/${summary.id}`)
    if (ruleset === null) continue
    const refs = (ruleset.conditions?.ref_name?.include ?? [])
    const covers = refs.length === 0 || refs.some((pattern) => {
      if (pattern === '~DEFAULT_BRANCH') return false
      if (pattern === `refs/heads/${base}`) return true
      if (pattern.endsWith('/*')) return base.startsWith(pattern.slice('refs/heads/'.length, -1))
      return false
    })
    if (covers && (ruleset.rules ?? []).some(rule => rule.type === 'pull_request')) return true
  }
  return false
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
  const blockers = autoMergeBlockers({
    base: pull.base.ref,
    isDraft: pull.draft,
    state: pull.state,
    mergeable: pull.mergeable,
    protectedBranch: baseEnforcesReview(repository, pull.base.ref),
  })
  if (blockers.length > 0) {
    process.stdout.write(`Not enabling auto-merge:\n${blockers.map(reason => `  - ${reason}`).join('\n')}\n`)
    return
  }
  // Already enabled is not a failure: `synchronize` re-runs this on every push.
  const enabled = apiOrNull(`repos/${repository}/pulls/${number}/auto_merge`, {
    method: 'POST',
    body: { merge_method: 'squash' },
  })
  process.stdout.write(enabled === null
    ? `::warning::Enabling auto-merge on #${number} failed; the next event retries.\n`
    : `Auto-merge enabled on #${number}; GitHub merges when review and checks allow.\n`)
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
