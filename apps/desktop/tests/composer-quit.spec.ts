import { describe, expect, it, vi } from 'vitest'
import { releaseComposerForQuit, type ComposerReleaseTarget } from '../src/composer-quit.ts'
import { en } from '../src/locale.ts'
import type { ComposerRelease } from '../src/composer-sidecar.ts'

function target(release: ComposerRelease | Error, decision: ComposerRelease = { status: 'released' }) {
  return {
    release: vi.fn(() => release instanceof Error ? Promise.reject(release) : Promise.resolve(release)),
    codexDecision: vi.fn((_decision: 'continue' | 'resume') => Promise.resolve(decision)),
  } satisfies ComposerReleaseTarget
}

function run(value: ComposerReleaseTarget | undefined, response = 0) {
  const show = vi.fn(() => Promise.resolve({ response, checkboxChecked: false }))
  const onError = vi.fn()
  return { result: releaseComposerForQuit({ target: () => value, messages: () => en, show, onError }), show, onError }
}

describe('composer quit release', () => {
  it('quits without asking when no sidecar serves or the release completes', async () => {
    expect(await run(undefined).result).toBe(true)
    const released = target({ status: 'released' })
    const r = run(released)
    expect(await r.result).toBe(true)
    expect(r.show).not.toHaveBeenCalled()
    expect(released.codexDecision).not.toHaveBeenCalled()
  })

  it('never blocks quitting on a failed release', async () => {
    const failed = run(target({ status: 'failed', error: 'busy' }))
    expect(await failed.result).toBe(true)
    expect(failed.onError).toHaveBeenCalledWith(new Error('nexus composer release failed: busy'))
    const thrown = run(target(new Error('not running')))
    expect(await thrown.result).toBe(true)
    expect(thrown.onError).toHaveBeenCalledWith(new Error('not running'))
  })

  it('asks before quitting while Codex Desktop must restart, defaulting to cancel', async () => {
    const quitAnyway = target({ status: 'awaitingCodexDecision' })
    const accepted = run(quitAnyway, 0)
    expect(await accepted.result).toBe(true)
    expect(quitAnyway.codexDecision).toHaveBeenCalledWith('continue')
    expect(accepted.show).toHaveBeenCalledWith(expect.objectContaining({
      message: en.composerCodexRestartTitle, buttons: [en.quitAnyway, en.cancel], defaultId: 1, cancelId: 1,
    }))

    const keep = target({ status: 'awaitingCodexDecision' }, { status: 'cancelled' })
    expect(await run(keep, 1).result).toBe(false)
    expect(keep.codexDecision).toHaveBeenCalledWith('resume')
  })

  it('honours Cancel even when resuming Codex routing failed', async () => {
    const broken = target({ status: 'awaitingCodexDecision' }, { status: 'failed', error: 'reconcile' })
    const r = run(broken, 1)
    expect(await r.result).toBe(false)
    expect(r.onError).toHaveBeenCalledWith(new Error('nexus composer release failed: reconcile'))
  })
})
