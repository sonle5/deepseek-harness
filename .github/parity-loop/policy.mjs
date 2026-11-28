/** Pure decisions for the develop parity loop: review routing, the evidence warning, and auto-merge eligibility. */

/**
 * The agents that review parity PRs, most senior first. The first entry reviews
 * every PR opened by someone outside this list; an agent's PR goes to the most
 * senior other agent, because GitHub rejects a review request to the author.
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
 * Choose who reviews a pull request.
 * @param {string|undefined} author Login of the pull-request author.
 * @param {readonly string[]} [reviewers] Reviewer pool, most senior first.
 * @returns {string|null} The primary reviewer for an author outside the pool,
 *   the most senior other reviewer for an author inside it, or null when the
 *   pool holds no reviewer besides the author.
 */
export function reviewerFor(author, reviewers = REVIEWERS) {
  if (!reviewers.includes(author)) return reviewers[0] ?? null
  return reviewers.find(login => login !== author) ?? null
}

/**
 * Decide whether the routed reviewer still needs requesting.
 *
 * A reviewer who already reviewed is not re-requested: re-requesting would
 * dismiss nothing but would queue the agent again on every push.
 * @param {object} input Review state.
 * @param {string} input.reviewer Login of the routed reviewer.
 * @param {readonly string[]} input.requested Logins with an outstanding request.
 * @param {readonly string[]} input.reviewed Logins whose latest review is decisive.
 * @param {boolean} input.latestDismissed Whether the routed reviewer's latest review is a dismissal.
 * @returns {boolean} Whether to request a review.
 */
export function needsReviewRequest({ reviewer, requested, reviewed, latestDismissed }) {
  if (requested.includes(reviewer)) return false
  // Only the reviewer's *latest* verdict matters. A dismissal followed by a
  // fresh approval is settled; a dismissal as the latest verdict is not.
  if (latestDismissed) return true
  return !reviewed.includes(reviewer)
}

/**
 * Reduce a review list to each reviewer's latest verdict.
 *
 * Dismissed reviews are kept, because a dismissal followed by an approval must
 * be told apart from one that is still the reviewer's last word.
 * @param {readonly {user: {login: string}, state: string}[]} reviews Reviews oldest first.
 * @param {string} reviewer Login of the routed reviewer.
 * @returns {{reviewed: string[], latestDismissed: boolean}} Logins with a decisive latest review, and whether the routed reviewer's latest is a dismissal.
 */
export function latestVerdicts(reviews, reviewer) {
  const latest = new Map()
  for (const review of reviews) {
    const state = review.state?.toUpperCase()
    if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'DISMISSED') continue
    latest.set(review.user.login, state)
  }
  return {
    reviewed: [...latest.keys()],
    latestDismissed: latest.get(reviewer) === 'DISMISSED',
  }
}

/**
 * Check runs that must conclude `success` on the head commit before the loop
 * lets it merge. `develop` requires no status checks in its protection, so
 * GitHub's auto-merge waits for none of them; the loop enforces these itself.
 * Each is the verdict job of one pull-request workflow (CI, CI Windows, CI
 * Python, Build PR preview).
 */
export const GATING_CHECKS = Object.freeze([
  'all checks passed',
  'windows checks passed',
  'python checks passed',
  'cloudflare pages preview',
])

/** The app whose check runs count toward the gate; any other app's run of the same name is ignored. */
export const GATING_CHECK_APP = 'github-actions'

/**
 * Classify the gating checks on one commit.
 *
 * Only the latest run of each name counts (the highest id), so a re-run that is
 * still in progress replaces the failure it re-runs. A gating check with no run
 * yet is pending, never passing. So is one that concluded `skipped`: every
 * gating job skips itself on a draft (`!github.event.pull_request.draft`), and
 * a skip is no verdict — nothing failed, and the job runs for real once the
 * pull request is marked ready. Counting it as failing would report four
 * failures on every draft push, which no fix or re-run can clear.
 * @param {readonly {id: number, name: string, status: string, conclusion: string|null, html_url: string, app: {slug: string}|null}[]} checkRuns
 *   Check runs of the commit, in any order.
 * @param {readonly string[]} [gating] Names that must succeed.
 * @returns {{failing: {name: string, url: string, conclusion: string}[], pending: string[]}} Gating checks that concluded other than `success` or `skipped`, and those not yet concluded or skipped.
 */
export function ciGate(checkRuns, gating = GATING_CHECKS) {
  const latest = new Map()
  for (const run of checkRuns) {
    if (run.app?.slug !== GATING_CHECK_APP || !gating.includes(run.name)) continue
    if ((latest.get(run.name)?.id ?? -1) < run.id) latest.set(run.name, run)
  }
  const failing = []
  const pending = []
  for (const name of gating) {
    const run = latest.get(name)
    if (run === undefined || run.status !== 'completed' || run.conclusion === 'skipped') pending.push(name)
    else if (run.conclusion !== 'success') failing.push({ name, url: run.html_url, conclusion: run.conclusion })
  }
  return { failing, pending }
}

/** Hidden marker that ties a failing-checks comment to the commit it reports. */
const FAILING_CHECKS_MARKER = 'parity-loop-failing-checks'

/**
 * Build the pull-request comment that names the gating checks failing on a
 * head commit, and the marker that finds an earlier copy of it.
 * @param {object} input Failing checks.
 * @param {string} input.headSha Commit the checks ran on.
 * @param {readonly {name: string, url: string, conclusion: string}[]} input.failing Failing gating checks.
 * @returns {{marker: string, body: string}} The marker, which the body contains, and the comment body.
 */
export function failingChecksComment({ headSha, failing }) {
  const marker = `<!-- ${FAILING_CHECKS_MARKER}:${headSha} -->`
  const lines = failing.map(check => `- [\`${check.name}\`](${check.url}): ${check.conclusion}`)
  return {
    marker,
    body: `${marker}\nThe Parity loop will not merge ${headSha} while these gating checks fail on it:\n\n${lines.join('\n')}\n\nAn approval does not override them. Push a fix, or re-run a check that failed for an unrelated reason; the loop re-evaluates when the checks finish.\n`,
  }
}

/**
 * Choose the pull requests a finished `workflow_run` asks the loop to
 * re-evaluate: those into the integration branch of this repository that the
 * run was for. GitHub leaves `pull_requests` empty for a run from a fork.
 * @param {any} event Workflow event payload.
 * @returns {number[]} Pull-request numbers, without duplicates.
 */
export function workflowRunPullNumbers(event) {
  const numbers = (event?.workflow_run?.pull_requests ?? [])
    .filter(pull => pull.base?.ref === TARGET_BASE && pull.base?.repo?.id === event.repository?.id)
    .map(pull => pull.number)
  return [...new Set(numbers)]
}

/**
 * List what still blocks letting the pull request merge.
 *
 * The loop enables GitHub's auto-merge, or merges a pull request GitHub already
 * considers mergeable, and in both cases GitHub applies the branch's
 * protection: a required approval and dismissal of stale approvals on push.
 * That protection requires no status checks on `develop`, so the gating checks
 * are the one condition this loop enforces itself, against the head commit it
 * pins with `expectedHeadOid`.
 *
 * The other blockers are what make auto-merge meaningless: a wrong base, a
 * closed or draft pull request, a branch GitHub cannot merge, and a branch that
 * does not require review, where enabling auto-merge lands the head without
 * waiting for anyone. A pull request that changes a file under
 * `.github/workflows/` is left for a person to merge: GitHub refuses to let the
 * workflow token enable auto-merge on, or merge, a workflow change without the
 * `workflows` permission, which `GITHUB_TOKEN` cannot be granted.
 * @param {object} input Pull-request state.
 * @param {string} input.base Base branch.
 * @param {boolean} input.isDraft Whether the pull request is a draft.
 * @param {string} input.state `open` or `closed`.
 * @param {boolean|null} input.mergeable GitHub's computed mergeability (`null` while pending).
 * @param {boolean|null} input.protectedBranch Whether the base branch is protected at all, or `null` when it cannot be read.
 * @param {string|null} input.reviewDecision GitHub's review decision for the pull request, or `null` when no rule requires review.
 * @param {{failing: readonly {name: string}[], pending: readonly string[]}} input.gate Gating checks on the head commit, from `ciGate`.
 * @param {readonly string[]} input.changedFiles Repository paths the pull request changes.
 * @returns {string[]} Blocking reasons; empty means the pull request may merge once GitHub's protection allows.
 */
export function autoMergeBlockers({
  base,
  isDraft,
  state,
  mergeable,
  protectedBranch,
  reviewDecision,
  gate,
  changedFiles,
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
  const checkList = names => names.map(name => `\`${name}\``).join(', ')
  if (gate.failing.length > 0) blockers.push(`Gating checks failed on the head commit: ${checkList(gate.failing.map(check => check.name))}.`)
  if (gate.pending.length > 0) blockers.push(`Gating checks have not finished on the head commit: ${checkList(gate.pending)}.`)
  const workflowFiles = changedFiles.filter(path => path.startsWith('.github/workflows/'))
  if (workflowFiles.length > 0) {
    blockers.push(`Changes workflow files (${checkList(workflowFiles)}), which the workflow token cannot merge; a person merges this pull request.`)
  }
  return blockers
}

/**
 * Decide what to do with the pull request's auto-merge.
 *
 * Auto-merge stays on across pushes, and GitHub merges as soon as an approval
 * arrives, so an auto-merge enabled for an earlier head must be turned off
 * while the current head's gating checks fail or run. Other blockers leave it
 * as it is: they are transient (mergeability not yet computed) or GitHub
 * refuses the merge on its own (a draft, a conflict).
 * @param {object} input Decision inputs.
 * @param {readonly string[]} input.blockers Reasons from `autoMergeBlockers`.
 * @param {{failing: readonly unknown[], pending: readonly unknown[]}} input.gate Gating checks on the head commit, from `ciGate`.
 * @param {boolean} input.autoMergeEnabled Whether auto-merge is currently on.
 * @returns {'enable'|'disable'|'wait'} `enable` when nothing blocks, `disable` when a gating check blocks an enabled auto-merge, otherwise `wait`.
 */
export function autoMergeAction({ blockers, gate, autoMergeEnabled }) {
  if (blockers.length === 0) return 'enable'
  if (autoMergeEnabled && (gate.failing.length > 0 || gate.pending.length > 0)) return 'disable'
  return 'wait'
}

/** Labels whose pull requests must show evidence from a packaged build. */
export const EVIDENCE_AREAS = Object.freeze(['area/desktop', 'area/client'])

/** The pull-request template's heading for packaged-build evidence. */
export const EVIDENCE_HEADING = '## User-visible evidence'

/**
 * Decide whether to warn that a pull request lacks packaged-build screenshots.
 *
 * Report-only: the caller prints a warning and never fails the run. The
 * reviewer still judges whether the evidence comes from a packaged build and
 * covers every acceptance criterion.
 * @param {object} input Pull-request state.
 * @param {readonly string[]} input.labels Label names on the pull request.
 * @param {string|null|undefined} input.body Pull-request description.
 * @returns {string|null} The warning, or null when the pull request carries no
 *   evidence area, its evidence section has an image, or the section states
 *   `N/A — no user-visible change`.
 */
export function missingEvidenceWarning({ labels, body }) {
  const areas = EVIDENCE_AREAS.filter(area => labels.includes(area))
  if (areas.length === 0) return null
  const section = evidenceSection(body ?? '')
  if (section !== null && /^\s*N\/A\s+—\s+no user-visible change\b/mu.test(section)) return null
  if (section !== null && /!\[[^\]]*\]\([^)]+\)|<img\b/iu.test(section)) return null
  const where = section === null ? `has no \`${EVIDENCE_HEADING}\` section` : `has no image in its \`${EVIDENCE_HEADING}\` section`
  return `This pull request carries ${areas.map(area => `\`${area}\``).join(' and ')} but ${where}. Add before/after screenshots from a packaged build, or state \`N/A — no user-visible change\` with a reason (.github/PARITY-REVIEW.md, Reviewing a PR).`
}

/**
 * Extract the evidence section from a description, without HTML comments.
 * @param {string} body Pull-request description.
 * @returns {string|null} The text between the evidence heading and the next
 *   second-level heading, or null when the heading is absent.
 */
function evidenceSection(body) {
  const lines = body.replace(/<!--[\s\S]*?-->/gu, '').split(/\r?\n/u)
  const start = lines.findIndex(line => line.trim() === EVIDENCE_HEADING)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^## /u.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * GraphQL `mergedBy` login of a merge that GitHub's auto-merge made for the
 * loop. Auto-merge merges as the identity that enabled it, here the workflow
 * `GITHUB_TOKEN`, and GitHub does not apply closing keywords to those merges.
 */
export const LOOP_MERGER = 'github-actions'

/**
 * How long after its merge a loop-merged pull request still has its issues
 * closed. It bounds the sweep to recent merges and leaves older history alone.
 */
export const CLOSE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Choose the issues to close for one merged pull request, in place of the
 * closing-keyword close that GitHub skips for loop merges.
 *
 * Only the pull request's `closingIssuesReferences` qualify, so a bare `#N` or
 * `Refs #N` closes nothing. An issue is left alone once anyone has closed or
 * reopened it at or after the merge — GitHub itself, a person, or an earlier
 * run of this sweep — so a repeat run never closes or comments twice and a
 * deliberate reopen stands.
 * @param {object} input Merged pull request and the time of the sweep.
 * @param {string} input.repository `owner/name` the token can close issues in.
 * @param {object} input.pull Merged pull request.
 * @param {string|null} input.pull.mergedBy GraphQL login of the merger.
 * @param {string} input.pull.mergedAt ISO time of the merge.
 * @param {readonly {number: number, repository: string, state: string, lastStateChangeAt: string|null}[]} input.pull.issues
 *   Closing references, each with the time of its latest close or reopen.
 * @param {number} input.now Sweep time in epoch milliseconds.
 * @returns {number[]} Numbers of the issues to close.
 */
export function issuesToClose({ repository, pull, now }) {
  if (pull.mergedBy !== LOOP_MERGER) return []
  const mergedAt = Date.parse(pull.mergedAt)
  if (now - mergedAt > CLOSE_WINDOW_MS) return []
  return pull.issues
    .filter(issue => issue.repository === repository
      && issue.state === 'OPEN'
      && (issue.lastStateChangeAt === null || Date.parse(issue.lastStateChangeAt) < mergedAt))
    .map(issue => issue.number)
}

/**
 * Read the reviewed pull request's number from a `workflow_run` event of the
 * `weighted-approval-review-event` workflow, whose run name is
 * `weighted-approval-review-event:<number>`.
 * @param {any} event Workflow event payload.
 * @returns {number|null} The pull-request number, or null for any other event.
 */
export function reviewedPullNumber(event) {
  const match = /^weighted-approval-review-event:([1-9][0-9]*)$/u.exec(event?.workflow_run?.display_title ?? '')
  return match === null ? null : Number(match[1])
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

/**
 * Whether a failed auto-merge mutation means GitHub already considers the pull
 * request mergeable, so there is nothing for auto-merge to wait on. GitHub
 * reports this as the `clean` or `unstable` merge state; `unstable` means only
 * checks that the branch does not require are failing.
 * @param {unknown} error Failure from the mutation.
 * @returns {boolean} True when the mutation refused because the pull request can merge now.
 */
export function autoMergeNotNeeded(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /pull request is in (clean|unstable) status/i.test(message)
}
