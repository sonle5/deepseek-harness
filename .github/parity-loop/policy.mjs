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
 * @param {object} input Review state.
 * @param {readonly string[]} input.requested Logins with an outstanding request.
 * @param {readonly string[]} input.reviewed Logins whose latest review is decisive.
 * @param {boolean} input.latestDismissed Whether the reviewer's own latest review is a dismissal.
 * @param {boolean} input.authoredByReviewer Whether the reviewer opened this pull request.
 * @returns {boolean} Whether to request a review.
 */
export function needsReviewRequest({ requested, reviewed, latestDismissed, authoredByReviewer }) {
  // GitHub rejects a review request from the author with 422, and an author
  // cannot approve their own pull request, so an agent-authored PR needs a
  // human approver and must not route to the agent at all.
  if (authoredByReviewer) return false
  if (requested.includes(REVIEWER)) return false
  // Only the reviewer's *latest* verdict matters. A dismissal followed by a
  // fresh approval is settled; a dismissal as the latest verdict is not.
  if (latestDismissed) return true
  return !reviewed.includes(REVIEWER)
}

/**
 * Reduce a review list to each reviewer's latest verdict.
 *
 * Dismissed reviews are kept, because a dismissal followed by an approval must
 * be told apart from one that is still the reviewer's last word.
 * @param {readonly {user: {login: string}, state: string}[]} reviews Reviews oldest first.
 * @returns {{reviewed: string[], latestDismissed: boolean}} Logins with a decisive latest review, and whether the reviewer's latest is a dismissal.
 */
export function latestVerdicts(reviews) {
  const latest = new Map()
  for (const review of reviews) {
    const state = review.state?.toUpperCase()
    if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'DISMISSED') continue
    latest.set(review.user.login, state)
  }
  return {
    reviewed: [...latest.keys()],
    latestDismissed: latest.get(REVIEWER) === 'DISMISSED',
  }
}

/**
 * List what still blocks enabling GitHub's auto-merge.
 *
 * The loop does not merge. It asks GitHub to, and GitHub applies the branch's
 * protection: a required approval, dismissal of stale approvals on push, and
 * the required checks. Doing it that way means the approval, the reviewed
 * commit and the check results are all enforced by GitHub against the commit
 * being merged, and there is no merge call for a pull request to subvert.
 *
 * So the only things worth blocking on here are the ones that make auto-merge
 * meaningless: a wrong base, a closed or draft pull request, a branch GitHub
 * cannot merge, and — the important one — a branch whose review requirement
 * cannot be confirmed.
 * @param {object} input Pull-request state.
 * @param {string} input.base Base branch.
 * @param {boolean} input.isDraft Whether the pull request is a draft.
 * @param {string} input.state `open` or `closed`.
 * @param {boolean|null} input.mergeable GitHub's computed mergeability (`null` while pending).
 * @param {boolean|null} input.protectedBranch Whether the base branch enforces review, or `null` when the token cannot read its protection.
 * @returns {string[]} Blocking reasons; empty means auto-merge may be enabled.
 */
export function autoMergeBlockers({ base, isDraft, state, mergeable, protectedBranch }) {
  const blockers = []
  const baseError = baseBranchError(base)
  if (baseError !== null) blockers.push(baseError)
  if (state !== 'open') blockers.push(`Pull request is ${state}.`)
  if (isDraft) blockers.push('Pull request is a draft.')
  // GitHub computes mergeability lazily, so `null` means "ask again", never
  // "probably fine".
  if (mergeable !== true) blockers.push('GitHub has not confirmed the pull request is mergeable.')
  // Without protection there is nothing for auto-merge to wait on, and enabling
  // it merges the head immediately — the opposite of the intent. An unreadable
  // protection setting is reported separately: it is a token problem to fix,
  // not evidence that the branch is unprotected.
  if (protectedBranch === null) {
    blockers.push(`Cannot verify that \`${TARGET_BASE}\` requires review; the token cannot read its protection.`)
  } else if (protectedBranch !== true) {
    blockers.push(`\`${TARGET_BASE}\` is not protected; auto-merge would land unreviewed.`)
  }
  return blockers
}

/**
 * Whether a failed auto-merge mutation only means this pull request already has
 * auto-merge on, which every re-run after a push will hit.
 * @param {unknown} error Failure from the mutation.
 * @returns {boolean} True when the mutation refused because it was already enabled.
 */
export function autoMergeAlreadyEnabled(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /automerge is already enabled/i.test(message)
}
