/** Pure decisions for the develop parity loop: review routing and auto-merge eligibility. */

/**
 * The agent accounts that review parity pull requests, most senior first.
 *
 * The first entry is the reviewer every human-authored pull request goes to.
 * The rest exist so an agent-authored pull request can be reviewed by its peer:
 * GitHub rejects a review request from the author with 422 and excludes the
 * author from approving, so the loop routes an agent's pull request to the
 * *other* agent instead of leaving it for a human.
 */
export const REVIEWERS = Object.freeze(['onenexus-superagent', 'onenexus-superagent-hdt98'])

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
 * The reviewer to route a pull request to, given its author.
 *
 * A reviewer may not review its own pull request, so an agent-authored one goes
 * to a peer agent. A pull request by anyone else — a human, or a bot the loop
 * does not know — goes to the primary reviewer. `null` means there is no
 * eligible reviewer at all: the author is the only configured agent, so the
 * pull request must wait for a human.
 * @param {string|undefined|null} author Login of the pull-request author.
 * @param {readonly string[]} [reviewers] Reviewer logins, most senior first.
 * @returns {string|null} The login to request, or null when no peer exists.
 */
export function reviewerFor(author, reviewers = REVIEWERS) {
  // A pull request from someone outside the reviewer pool goes to the primary.
  if (!reviewers.includes(author)) return reviewers[0] ?? null
  // Otherwise take the most senior reviewer who is not the author. With one
  // agent configured, an agent-authored pull request has no peer: null, not a
  // request GitHub would reject.
  return reviewers.find(login => login !== author) ?? null
}

/**
 * Reduce a review list to each reviewer's latest decisive verdict.
 *
 * Dismissed reviews are kept, because a dismissal followed by an approval must
 * be told apart from one that is still the reviewer's last word.
 *
 * The verdict of the reviewer that will actually be asked is read from this map
 * by the caller, rather than pre-computed here: which reviewer that is depends
 * on the pull request's author, and computing a single `latestDismissed` up
 * front would answer for the wrong reviewer on an agent-authored pull request.
 * @param {readonly {user: {login: string}, state: string}[]} reviews Reviews oldest first.
 * @returns {Map<string, string>} Login to that reviewer's latest `APPROVED`, `CHANGES_REQUESTED` or `DISMISSED` state.
 */
export function latestVerdicts(reviews) {
  const latest = new Map()
  for (const review of reviews) {
    const state = review.state?.toUpperCase()
    if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'DISMISSED') continue
    latest.set(review.user.login, state)
  }
  return latest
}

/**
 * Decide whether the reviewer still needs requesting.
 *
 * A reviewer who already reviewed is not re-requested: re-requesting would
 * dismiss nothing but would queue the agent again on every push.
 * @param {object} input Review state.
 * @param {string|undefined|null} input.author Login of the pull-request author.
 * @param {readonly string[]} input.requested Logins with an outstanding request.
 * @param {Map<string, string>} input.verdicts Each reviewer's latest decisive state.
 * @returns {boolean} Whether to request a review.
 */
export function needsReviewRequest({ author, requested, verdicts }) {
  const reviewer = reviewerFor(author)
  // No peer to route to. Requesting the author is a 422 and the author cannot
  // approve, so the loop leaves the pull request to a human rather than fail.
  if (reviewer === null) return false
  if (requested.includes(reviewer)) return false
  // Only the reviewer's *latest* verdict matters. A dismissal followed by a
  // fresh approval is settled; a dismissal as the latest verdict is not.
  const verdict = verdicts.get(reviewer)
  if (verdict === 'DISMISSED') return true
  return verdict !== 'APPROVED' && verdict !== 'CHANGES_REQUESTED'
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
 * cannot merge, and — the important one — a branch that does not require
 * review, where enabling auto-merge lands the head without waiting for anyone.
 * @param {object} input Pull-request state.
 * @param {string} input.base Base branch.
 * @param {boolean} input.isDraft Whether the pull request is a draft.
 * @param {string} input.state `open` or `closed`.
 * @param {boolean|null} input.mergeable GitHub's computed mergeability (`null` while pending).
 * @param {boolean|null} input.protectedBranch Whether the base branch is protected at all, or `null` when it cannot be read.
 * @param {string|null} input.reviewDecision GitHub's review decision for the pull request, or `null` when no rule requires review.
 * @returns {string[]} Blocking reasons; empty means auto-merge may be enabled.
 */
export function autoMergeBlockers({
  base,
  isDraft,
  state,
  mergeable,
  protectedBranch,
  reviewDecision,
}) {
  const blockers = []
  const baseError = baseBranchError(base)
  if (baseError !== null) blockers.push(baseError)
  if (state !== 'open') blockers.push(`Pull request is ${state}.`)
  if (isDraft) blockers.push('Pull request is a draft.')
  // GitHub computes mergeability lazily, so `null` means "ask again", never
  // "probably fine".
  if (mergeable !== true) blockers.push('GitHub has not confirmed the pull request is mergeable.')
  // Without protection there is nothing for auto-merge to wait on, and enabling
  // it merges the head immediately — the opposite of the intent. Each way of
  // not knowing gets its own reason because each needs a different fix: an
  // unreadable flag is a token problem, a protected branch with no review rule
  // is a protection setting to change, and a null decision on a protected
  // branch is the same setting seen from the pull request's side.
  if (protectedBranch === null) {
    blockers.push(`Cannot verify that \`${TARGET_BASE}\` is protected; the token cannot read the branch.`)
  } else if (protectedBranch !== true) {
    blockers.push(`\`${TARGET_BASE}\` is not protected; auto-merge would land unreviewed.`)
  } else if (reviewDecision === null) {
    blockers.push(`\`${TARGET_BASE}\` is protected but requires no approving review; auto-merge would land unreviewed.`)
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
