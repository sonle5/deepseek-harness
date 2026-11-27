import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoMergeAlreadyEnabled,
  autoMergeBlockers,
  baseBranchError,
  EVIDENCE_HEADING,
  latestVerdicts,
  missingEvidenceWarning,
  needsReviewRequest,
  reviewerFor,
  REVIEWERS,
  TARGET_BASE,
} from './policy.mjs'
import { readFileSync } from 'node:fs'

const clean = {
  base: 'develop',
  isDraft: false,
  state: 'open',
  mergeable: true,
  protectedBranch: true,
  reviewDecision: 'REVIEW_REQUIRED',
}

test('develop is the only pull-request base', () => {
  assert.equal(TARGET_BASE, 'develop')
  assert.equal(baseBranchError('develop'), null)
  // master mirrors upstream, so it is never a merge target here.
  assert.match(baseBranchError('master'), /must target `develop`/u)
})

const [PRIMARY, PEER] = REVIEWERS

test('the reviewer pool names each agent once', () => {
  assert.ok(REVIEWERS.length >= 2, 'peer routing needs at least two agents')
  assert.equal(new Set(REVIEWERS).size, REVIEWERS.length)
  assert.ok(Object.isFrozen(REVIEWERS))
})

test('a pull request from outside the pool goes to the primary reviewer', () => {
  assert.equal(PRIMARY, 'onenexus-superagent-hdt98')
  assert.equal(reviewerFor('sonle5'), PRIMARY)
  assert.equal(reviewerFor(undefined), PRIMARY)
})

test('an agent-authored pull request goes to a peer, never to its author', () => {
  // GitHub rejects a review request to the author with 422, and an author
  // cannot approve their own pull request.
  assert.equal(reviewerFor(PRIMARY), PEER)
  assert.equal(reviewerFor(PEER), PRIMARY)
})

test('a third agent extends peer routing to the most senior non-author', () => {
  const pool = ['a', 'b', 'c']
  assert.equal(reviewerFor('a', pool), 'b')
  assert.equal(reviewerFor('b', pool), 'a')
  assert.equal(reviewerFor('c', pool), 'a')
  assert.equal(reviewerFor('human', pool), 'a')
})

test('a single-entry pool has no peer for its own pull requests', () => {
  assert.equal(reviewerFor('solo', ['solo']), null)
  assert.equal(reviewerFor('human', ['solo']), 'solo')
})

test('the routed reviewer is requested once, and again only after a dismissal', () => {
  const route = overrides => needsReviewRequest({
    reviewer: PEER, requested: [], reviewed: [], latestDismissed: false, ...overrides,
  })
  assert.equal(route({}), true)
  assert.equal(route({ requested: [PEER] }), false)
  assert.equal(route({ reviewed: [PEER] }), false)
  // Another account's request or verdict does not stand in for the routed reviewer's.
  assert.equal(route({ requested: [PRIMARY] }), true)
  assert.equal(route({ reviewed: [PRIMARY] }), true)
  // Code moved under a dismissed review, so ask again.
  assert.equal(route({ reviewed: [PEER], latestDismissed: true }), true)
})

test('a dismissal followed by an approval stops asking for review', () => {
  // The sequence dismiss → re-request → approve must settle. Counting any past
  // dismissal instead of the latest verdict re-requests an approved PR forever.
  for (const reviewer of [PRIMARY, PEER]) {
    const verdicts = latestVerdicts([
      { user: { login: reviewer }, state: 'DISMISSED' },
      { user: { login: reviewer }, state: 'APPROVED' },
    ], reviewer)
    assert.equal(verdicts.latestDismissed, false, reviewer)
    assert.equal(needsReviewRequest({
      reviewer, requested: [], reviewed: verdicts.reviewed, latestDismissed: verdicts.latestDismissed,
    }), false, reviewer)
  }
})

test('only the routed reviewer’s dismissal asks for review again', () => {
  const reviews = [
    { user: { login: PRIMARY }, state: 'DISMISSED' },
    { user: { login: PEER }, state: 'APPROVED' },
  ]
  assert.equal(latestVerdicts(reviews, PEER).latestDismissed, false)
  assert.equal(latestVerdicts(reviews, PRIMARY).latestDismissed, true)
})

test('each reviewer’s latest verdict wins over their first', () => {
  const verdicts = latestVerdicts([
    { user: { login: PRIMARY }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'someone' }, state: 'COMMENTED' },
    { user: { login: PRIMARY }, state: 'APPROVED' },
  ], PRIMARY)
  assert.deepEqual(verdicts.reviewed, [PRIMARY])
  assert.equal(verdicts.latestDismissed, false)
})

test('auto-merge is enabled only when GitHub can enforce the review', () => {
  assert.deepEqual(autoMergeBlockers(clean), [])

  assert.ok(autoMergeBlockers({ ...clean, base: 'master' }).includes(baseBranchError('master')))
  assert.ok(autoMergeBlockers({ ...clean, isDraft: true }).includes('Pull request is a draft.'))
  assert.ok(autoMergeBlockers({ ...clean, state: 'closed' }).includes('Pull request is closed.'))
})

test('unconfirmed mergeability blocks instead of passing', () => {
  // `null` is "GitHub has not computed it yet"; it is never evidence of a merge.
  for (const mergeable of [null, false]) {
    assert.ok(autoMergeBlockers({ ...clean, mergeable })
      .includes('GitHub has not confirmed the pull request is mergeable.'), String(mergeable))
  }
})

test('an unprotected base blocks auto-merge', () => {
  // Enabling auto-merge on an unprotected branch merges immediately, which is
  // the failure this gate exists to prevent.
  assert.ok(autoMergeBlockers({ ...clean, protectedBranch: false })
    .includes('`develop` is not protected; auto-merge would land unreviewed.'))
})

test('protected but without a review rule blocks as its own reason', () => {
  // The failure the admin-only protection read caused: `branchProtectionRule`
  // is null for every token without Administration, so a protected base looked
  // unprotected. The `protected` flag and `reviewDecision` are both readable
  // with a write token, and this case is the state they actually report —
  // protected, but no rule asks for review — which must not land unreviewed.
  const blockers = autoMergeBlockers({ ...clean, reviewDecision: null })
  assert.deepEqual(blockers, [
    '`develop` is protected but requires no approving review; auto-merge would land unreviewed.',
  ])
})

test('an unreadable protection flag is distinct from an unreadable rule', () => {
  // Two different failures, two different fixes: one is a token that cannot
  // see the branch, the other a branch setting. Neither may read as the other.
  assert.deepEqual(autoMergeBlockers({ ...clean, protectedBranch: null }), [
    'Cannot verify that `develop` is protected; the token cannot read the branch.',
  ])
  assert.deepEqual(autoMergeBlockers({ ...clean, protectedBranch: true, reviewDecision: null }), [
    '`develop` is protected but requires no approving review; auto-merge would land unreviewed.',
  ])
})

test('auto-merge is enabled only when both protection facts are known', () => {
  // The positive case: a protected base whose review decision says a review
  // rule applies. REVIEW_REQUIRED and CHANGES_REQUESTED both map to this, so
  // auto-merge waits for the approval instead of merging the head.
  assert.deepEqual(autoMergeBlockers(clean), [])
  // CHANGES_REQUESTED is the same fact as REVIEW_REQUIRED for this gate: a
  // review rule applies. Auto-merge may be enabled; GitHub still waits for the
  // approval and the required checks before it merges.
  assert.deepEqual(autoMergeBlockers({ ...clean, reviewDecision: 'CHANGES_REQUESTED' }), [])
  assert.deepEqual(autoMergeBlockers({ ...clean, reviewDecision: 'APPROVED' }), [])
})

test('an already-enabled auto-merge is told apart from a real failure', () => {
  // `synchronize` re-runs the mutation on every push, and GitHub refuses with
  // this message once it is on; every other failure must surface.
  assert.equal(autoMergeAlreadyEnabled(
    new Error('GraphQL: Pull request AutoMerge is already enabled (enablePullRequestAutoMerge)'),
  ), true)
  assert.equal(autoMergeAlreadyEnabled(
    new Error('GraphQL: Could not resolve to a node with the global id of \'PR_bogus\' (enablePullRequestAutoMerge)'),
  ), false)
  assert.equal(autoMergeAlreadyEnabled(
    'Head branch was modified. Review and try the merge again.',
  ), false)
})

const evidenceBody = section => `## Motivation\n\nFixes #33\n\n## Testing\n\n![unit](https://example.test/unit.png)\n\n${EVIDENCE_HEADING}\n\n${section}\n`

test('a desktop or client pull request with an image in its evidence section is not flagged', () => {
  for (const labels of [['area/desktop'], ['area/client'], ['kind/bug-fix', 'area/desktop', 'area/client']]) {
    assert.equal(missingEvidenceWarning({
      labels,
      body: evidenceBody('**Before / after**: ![Dock icon at abc1234](https://example.test/dock.png)'),
    }), null, labels.join(','))
  }
  assert.equal(missingEvidenceWarning({
    labels: ['area/client'],
    body: evidenceBody('<img alt="About panel at abc1234" src="https://example.test/about.png">'),
  }), null)
})

test('a desktop or client pull request without an evidence image is flagged', () => {
  // An image elsewhere in the body, or one inside the template's comments, is
  // not evidence.
  const noImage = missingEvidenceWarning({
    labels: ['area/desktop'],
    body: evidenceBody('<!-- ![placeholder](https://example.test/x.png) -->\n**Before / after**: see the unit tests'),
  })
  assert.match(noImage, /`area\/desktop` but has no image in its `## User-visible evidence` section/u)
  const noSection = missingEvidenceWarning({ labels: ['area/client', 'area/desktop'], body: '## Motivation\n\n![x](https://example.test/x.png)\n' })
  assert.match(noSection, /`area\/desktop` and `area\/client` but has no `## User-visible evidence` section/u)
  assert.match(missingEvidenceWarning({ labels: ['area/client'], body: null }), /has no `## User-visible evidence` section/u)
})

test('the stated N/A path and other areas are not flagged', () => {
  assert.equal(missingEvidenceWarning({
    labels: ['area/desktop'],
    body: evidenceBody('N/A — no user-visible change: the diff only renames a test helper.'),
  }), null)
  assert.equal(missingEvidenceWarning({ labels: ['kind/doc', 'area/ci'], body: '' }), null)
})

test('the pull request template carries the evidence heading the check reads', () => {
  const template = readFileSync(new URL('../pull_request_template.md', import.meta.url), 'utf8')
  assert.ok(template.split('\n').includes(EVIDENCE_HEADING))
  assert.match(template, /N\/A — no user-visible change: <reason>/u)
})
