/** Pure decisions for the develop parity loop: review routing and auto-merge eligibility. */

/** The agent that reviews every parity PR, and the only reviewer the loop waits on. */
export const REVIEWER = 'onenexus-superagent'

/** The integration branch. `master` mirrors upstream and is never a PR base here. */
export const TARGET_BASE = 'develop'

/** Branches that may receive a pull request. */
const ALLOWED_BASES = new Set([TARGET_BASE])

/**
 * Reject a pull request aimed anywhere but the integration branch.
 * @param {string} base Base branch of the pull request.
 * @returns {string|null} A message when the base is wrong, otherwise null.
 */
export function baseBranchError(base) {
  if (ALLOWED_BASES.has(base)) return null
  return `Pull requests must target \`${TARGET_BASE}\`, not \`${base}\`. \`master\` mirrors upstream and is not a merge target here.`
}

/**
 * Decide whether the reviewer still needs requesting.
 *
 * A reviewer who already reviewed is not re-requested: re-requesting would
 * dismiss nothing but would queue the agent again on every push.
 * @param {{requested: readonly string[], reviewed: readonly string[], dismissed: boolean}} input Review state.
 * @returns {boolean} Whether to request a review.
 */
export function needsReviewRequest({ requested, reviewed, dismissed }) {
  if (requested.includes(REVIEWER)) return false
  // A dismissed review means the author moved the code under it; ask again.
  if (dismissed) return true
  return !reviewed.includes(REVIEWER)
}

/**
 * List what still blocks an automatic merge.
 *
 * The loop merges on its own only when the reviewer has approved and nothing is
 * outstanding: no requested change, no unresolved thread, no failing check that
 * GitHub reports as blocking, and the branch is the integration branch.
 * @param {object} input Pull-request review state.
 * @param {string} input.base Base branch.
 * @param {boolean} input.isDraft Whether the pull request is a draft.
 * @param {string} input.state `open` or `closed`.
 * @param {readonly string[]} input.approved Logins whose latest review approved.
 * @param {readonly string[]} input.changesRequested Logins whose latest review requested changes.
 * @param {number} input.unresolvedThreads Review threads not marked resolved.
 * @param {string} input.mergeStateStatus GitHub's mergeability summary.
 * @returns {string[]} Blocking reasons; empty means merge is allowed.
 */
export function autoMergeBlockers({
  base,
  isDraft,
  state,
  approved,
  changesRequested,
  unresolvedThreads,
  mergeStateStatus,
}) {
  const blockers = []
  const baseError = baseBranchError(base)
  if (baseError !== null) blockers.push(baseError)
  if (state !== 'open') blockers.push(`Pull request is ${state}.`)
  if (isDraft) blockers.push('Pull request is a draft.')
  if (!approved.includes(REVIEWER)) blockers.push(`@${REVIEWER} has not approved.`)
  if (changesRequested.length > 0) {
    blockers.push(`Changes requested by ${changesRequested.map(login => `@${login}`).join(', ')}.`)
  }
  if (unresolvedThreads > 0) {
    blockers.push(`${unresolvedThreads} review thread(s) still unresolved.`)
  }
  // `clean` and `has_hooks` are the only states where a merge will land as-is.
  if (!['clean', 'has_hooks', 'unknown'].includes(mergeStateStatus)) {
    blockers.push(`Merge state is \`${mergeStateStatus}\`.`)
  }
  return blockers
}

/**
 * Reduce a review list to each reviewer's latest verdict, in submission order.
 * @param {readonly {user: {login: string}, state: string}[]} reviews Reviews oldest first.
 * @returns {{approved: string[], changesRequested: string[], reviewed: string[]}} Latest verdicts.
 */
export function latestVerdicts(reviews) {
  const latest = new Map()
  for (const review of reviews) {
    const state = review.state?.toUpperCase()
    if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED') continue
    latest.set(review.user.login, state)
  }
  const approved = []
  const changesRequested = []
  for (const [login, state] of latest) {
    if (state === 'APPROVED') approved.push(login)
    else changesRequested.push(login)
  }
  return { approved, changesRequested, reviewed: [...latest.keys()] }
}
