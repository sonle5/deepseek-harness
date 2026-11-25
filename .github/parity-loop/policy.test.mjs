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
  approved: [REVIEWER],
  changesRequested: [],
  unresolvedThreads: 0,
  mergeStateStatus: 'clean',
}

test('develop is the only pull-request base', () => {
  assert.equal(TARGET_BASE, 'develop')
  assert.equal(baseBranchError('develop'), null)
  // master mirrors upstream, so it is never a merge target here.
  assert.match(baseBranchError('master'), /must target `develop`/u)
})

test('the reviewer is requested once, and again only after a dismissal', () => {
  assert.equal(needsReviewRequest({ requested: [], reviewed: [], dismissed: false }), true)
  assert.equal(needsReviewRequest({ requested: [REVIEWER], reviewed: [], dismissed: false }), false)
  assert.equal(needsReviewRequest({ requested: [], reviewed: [REVIEWER], dismissed: false }), false)
  // Code moved under a dismissed review, so ask again.
  assert.equal(needsReviewRequest({ requested: [], reviewed: [REVIEWER], dismissed: true }), true)
})

test('each reviewer’s latest verdict wins over their first', () => {
  const verdicts = latestVerdicts([
    { user: { login: REVIEWER }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'someone' }, state: 'COMMENTED' },
    { user: { login: REVIEWER }, state: 'APPROVED' },
  ])
  assert.deepEqual(verdicts.approved, [REVIEWER])
  assert.deepEqual(verdicts.changesRequested, [])
})

test('merge is allowed only on a clean approval with nothing outstanding', () => {
  assert.deepEqual(autoMergeBlockers(clean), [])

  assert.ok(autoMergeBlockers({ ...clean, approved: [] }).includes(`@${REVIEWER} has not approved.`))
  assert.ok(autoMergeBlockers({ ...clean, unresolvedThreads: 2 }).includes('2 review thread(s) still unresolved.'))
  assert.ok(autoMergeBlockers({ ...clean, base: 'master' }).includes(baseBranchError('master')))
  assert.ok(autoMergeBlockers({ ...clean, isDraft: true }).includes('Pull request is a draft.'))
  assert.ok(autoMergeBlockers({ ...clean, mergeStateStatus: 'dirty' }).includes('Merge state is `dirty`.'))
  assert.ok(autoMergeBlockers({ ...clean, state: 'closed' }).includes('Pull request is closed.'))
})
