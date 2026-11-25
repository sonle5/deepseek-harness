import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoMergeBlockers,
  baseBranchError,
  latestVerdicts,
  needsReviewRequest,
  REVIEWER,
  TARGET_BASE,
} from './policy.mjs'

const clean = {
  base: 'develop',
  isDraft: false,
  state: 'open',
  mergeable: true,
  protectedBranch: true,
}

test('develop is the only pull-request base', () => {
  assert.equal(TARGET_BASE, 'develop')
  assert.equal(baseBranchError('develop'), null)
  // master mirrors upstream, so it is never a merge target here.
  assert.match(baseBranchError('master'), /must target `develop`/u)
})

test('the reviewer is requested once, and again only after a dismissal', () => {
  const route = overrides => needsReviewRequest({
    requested: [], reviewed: [], latestDismissed: false, authoredByReviewer: false, ...overrides,
  })
  assert.equal(route({}), true)
  assert.equal(route({ requested: [REVIEWER] }), false)
  assert.equal(route({ reviewed: [REVIEWER] }), false)
  // Code moved under a dismissed review, so ask again.
  assert.equal(route({ reviewed: [REVIEWER], latestDismissed: true }), true)
})

test('a dismissal followed by an approval stops asking for review', () => {
  // The sequence dismiss → re-request → approve must settle. Counting any past
  // dismissal instead of the latest verdict re-requests an approved PR forever.
  const verdicts = latestVerdicts([
    { user: { login: REVIEWER }, state: 'DISMISSED' },
    { user: { login: REVIEWER }, state: 'APPROVED' },
  ])
  assert.equal(verdicts.latestDismissed, false)
  assert.equal(needsReviewRequest({
    requested: [], reviewed: verdicts.reviewed, latestDismissed: verdicts.latestDismissed, authoredByReviewer: false,
  }), false)
})

test('an agent-authored pull request is never routed to the agent', () => {
  // GitHub rejects the request with 422 and an author cannot approve, so the
  // loop must leave these to a human rather than fail on every event.
  assert.equal(needsReviewRequest({
    requested: [], reviewed: [], latestDismissed: false, authoredByReviewer: true,
  }), false)
})

test('each reviewer’s latest verdict wins over their first', () => {
  const verdicts = latestVerdicts([
    { user: { login: REVIEWER }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'someone' }, state: 'COMMENTED' },
    { user: { login: REVIEWER }, state: 'APPROVED' },
  ])
  assert.deepEqual(verdicts.reviewed, [REVIEWER])
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
