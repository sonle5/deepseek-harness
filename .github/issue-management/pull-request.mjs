/** Read-only PR snapshots and policy preflight/check workflow entry points. */

import fs from 'node:fs'
import process from 'node:process'

import config from './config.json' with { type: 'json' }
import { api, projectContext } from './github.mjs'
import {
  parseReferences,
  retainIssueReferences,
  requiresPullRequestPolicy,
  validatePullRequest,
} from './rules.mjs'

/**
 * Resolve all same-repository body references with REST, excluding pull-request numbers.
 * @param {number} number Pull-request number.
 * @param {{body?: string}} pull Current REST pull-request data.
 * @returns {Promise<object>} Issue-only references and placeholder priorities; never reads Project data.
 */
export async function resolvingReferencesSnapshot(number, pull) {
  const references = parseReferences({
    body: pull.body ?? '',
    repository: `${config.organization}/${config.repository}`,
  })
  const issues = new Map()
  for (const issueNumber of references.all) {
    const issue = await api(
      `/repos/${config.organization}/${config.repository}/issues/${issueNumber}`,
    )
    if (!issue.pull_request) issues.set(issueNumber, { priority: null })
  }
  return {
    number,
    references: retainIssueReferences(references, issues),
    issues,
  }
}

/**
 * Read current PR policy inputs, skipping references for exempt PRs.
 * @param {number} number Pull-request number.
 * @param {boolean} includeProject Read Project Priority for resolving Issues when true.
 * @returns {Promise<object>} Policy snapshot; rejects any failed read and performs no writes.
 */
export async function pullRequestSnapshot(number, includeProject = true) {
  const pull = await api(`/repos/${config.organization}/${config.repository}/pulls/${number}`)
  const snapshot = {
    number,
    isDraft: pull.draft,
    authorType: pull.user?.type ?? 'User',
    reviewRequestCount: 0,
    reviewCount: 0,
    labels: pull.labels.map((label) => label.name),
    references: { all: [], resolving: [], related: [] },
    issues: new Map(),
  }
  if (snapshot.isDraft || ['Bot', 'App'].includes(snapshot.authorType)) return snapshot
  const [reviewRequests, reviews] = await Promise.all([
    api(`/repos/${config.organization}/${config.repository}/pulls/${number}/requested_reviewers`),
    api(`/repos/${config.organization}/${config.repository}/pulls/${number}/reviews?per_page=100`),
  ])
  snapshot.reviewRequestCount = reviewRequests.users.length + reviewRequests.teams.length
  snapshot.reviewCount = reviews.length
  if (!requiresPullRequestPolicy(snapshot)) return snapshot
  Object.assign(snapshot, await resolvingReferencesSnapshot(number, pull))
  if (includeProject) {
    for (const issueNumber of snapshot.references.resolving) {
      const context = await projectContext(issueNumber)
      snapshot.issues.get(issueNumber).priority = context.item?.priorityValue?.name ?? null
    }
  }
  return snapshot
}

/**
 * Read PR creation time and Issue references without review eligibility gating.
 * @param {number} number Pull-request number.
 * @returns {Promise<object>} Lifecycle snapshot without Project reads or writes.
 */
export async function lifecyclePullRequestSnapshot(number) {
  const pull = await api(`/repos/${config.organization}/${config.repository}/pulls/${number}`)
  return {
    ...(await resolvingReferencesSnapshot(number, pull)),
    createdAt: pull.created_at,
  }
}

const EXEMPT_MESSAGE =
  'Issue policy exempt：当前 PR 不在强制范围（Draft、Bot/App 或尚无 review request/review）。\n'

/** The repository whose Project board this policy enforces. */
const POLICY_REPOSITORY = `${config.organization}/${config.repository}`

const FOREIGN_REPOSITORY_MESSAGE =
  'Issue policy 不适用：策略绑定 deepseek-harness/deepseek-harness 的 Project，当前仓库没有它。\n'

/**
 * Whether the policy governs the repository the workflow is running in.
 *
 * The policy enforces membership in one organization's Project board, which only
 * that repository has — anywhere else every Project read fails, and on a fork the
 * token step gives up earlier still, on an empty `client-id`.
 *
 * This check has to run here rather than as an `if:` on the job: GitHub executes
 * a `pull_request` workflow from the pull request head's copy of the workflow
 * file, while this module is checked out from the trusted default branch. A job
 * condition would be editable by the author of the pull request it is meant to
 * gate.
 *
 * Actions always provides `GITHUB_REPOSITORY`, so the unset case only arises
 * outside a workflow — a unit test or a local run. The policy is what is under
 * test there, so it applies.
 * @param {Record<string, string|undefined>} [environment] Process environment.
 * @returns {boolean} True when the policy governs the running repository.
 */
export function policyApplies(environment = process.env) {
  const running = environment.GITHUB_REPOSITORY
  return running === undefined || running === POLICY_REPOSITORY
}

/**
 * Report the fork exemption through the workflow outputs and stdout.
 * @returns {{eligible: boolean, needsProject: boolean}} The exempt decision.
 */
function reportForeignRepository() {
  if (process.env.GITHUB_OUTPUT) {
    // `legacy-automated` is deliberately left unset: it only gates the legacy
    // rollout, and the validate step must still run to print the exemption.
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'eligible=false\nexempt=true\nneeds-project=false\n')
  }
  process.stdout.write(FOREIGN_REPOSITORY_MESSAGE)
  return { eligible: false, needsProject: false }
}

/**
 * Determine current policy eligibility and Project access needs without Project credentials.
 * @param {{pull_request: {number: number}}} event GitHub event identifying the PR.
 * @returns {Promise<{eligible: boolean, needsProject: boolean}>} Trusted workflow decisions.
 */
export async function runPullRequestPreflight(event) {
  if (!policyApplies()) return reportForeignRepository()
  const pull = await pullRequestSnapshot(event.pull_request.number, false)
  const eligible = requiresPullRequestPolicy(pull)
  const needsProject = eligible && pull.references.resolving.length > 0
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `eligible=${eligible}\nexempt=${!eligible}\nneeds-project=${needsProject}\n`,
    )
  }
  process.stdout.write(eligible ? 'Issue policy applicable；执行完整校验。\n' : EXEMPT_MESSAGE)
  return { eligible, needsProject }
}

/**
 * Enforce all PR rules against current GitHub state, independently of preflight.
 * @param {{pull_request: {number: number}}} event GitHub event identifying the PR.
 * @returns {Promise<void>} Resolves on success or exemption; rejects policy failures.
 */
export async function runPullRequestCheck(event) {
  // The preflight output cannot gate this step on a fork (`legacy-automated` is
  // unset so the legacy path still validates), and the snapshot would otherwise
  // read the upstream repository's pull request with this fork's number — a
  // different pull request entirely. Exempt before the first read.
  if (!policyApplies()) {
    process.stdout.write(FOREIGN_REPOSITORY_MESSAGE)
    return
  }
  const pull = await pullRequestSnapshot(event.pull_request.number)
  const errors = validatePullRequest(pull)
  if (errors.length > 0) {
    for (const error of errors) process.stdout.write(`::error::${error}\n`)
    throw new Error(`Issue policy 未通过，共 ${errors.length} 项`)
  }
  process.stdout.write(
    requiresPullRequestPolicy(pull) ? 'Issue policy 通过。\n' : EXEMPT_MESSAGE,
  )
}
