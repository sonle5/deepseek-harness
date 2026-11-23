import { describe, expect, it, vi } from 'vitest'
import type { ComposerSidecarOptions } from '../src/composer-sidecar.ts'

vi.mock('electron', () => ({
  WebContentsView: vi.fn(), session: {}, shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

const { DesktopComposerSurface, COMPOSER_RESTART_DELAYS_MS } = await import('../src/composer-surface.ts')
type Status = InstanceType<typeof DesktopComposerSurface>['status']

const READY = { url: 'http://127.0.0.1:4321', version: '1', schemaVersion: 1, initStatus: null, ownership: 'isolated' }

/** Fake sidecars in creation order: each starts as the test script says and can fail after ready. */
function harness(script: Array<'ready' | 'fail'>, restore: 'ok' | 'fail' = 'ok') {
  const created: Array<{ options: ComposerSidecarOptions; stop: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> }> = []
  const statuses: Status[] = []
  const bridge: Array<string | undefined> = []
  const errors: Error[] = []
  const delays: number[] = []
  let clock = 0
  const surface = new DesktopComposerSurface({
    resources: { dist: '/dist', binary: '/bin/composer' }, preload: '/preload.js', home: '/tmp/isolated', ipc: false,
    environment: () => Promise.resolve({ PATH: '/login/bin', NEXUS_COMPOSER_TELEMETRY_CONSENT: 'granted' }),
    onError: (error) => { errors.push(error) },
    onStatus: (status) => { statuses.push(status) },
    onBridgeUrl: (url) => { bridge.push(url) },
    delay: (ms) => { delays.push(ms); return Promise.resolve() },
    now: () => clock,
    createSidecar: (options) => {
      const index = created.length
      const entry = {
        options,
        stop: vi.fn(() => Promise.resolve()),
        restore: vi.fn(() => restore === 'ok'
          ? Promise.resolve({ ownership: 'owner', codexRestartRequired: true })
          : Promise.reject(new Error('restore-failed'))),
      }
      created.push(entry)
      return {
        start: () => script[index] === 'ready' ? Promise.resolve(READY) : Promise.reject(new Error(`start ${String(index)} failed`)),
        invoke: vi.fn(() => Promise.resolve({ ok: index })),
        stop: entry.stop,
        restore: entry.restore,
      }
    },
  })
  return { surface, created, statuses, bridge, errors, delays, tick: (ms: number) => { clock += ms } }
}

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve)) }

describe('composer surface supervision', () => {
  it('passes the host environment and withholds telemetry consent unless granted', async () => {
    const h = harness(['ready'])
    await h.surface.start()
    const env = h.created[0]?.options.environment
    expect(env?.PATH).toBe('/login/bin')
    expect(env?.NEXUS_COMPOSER_TELEMETRY_CONSENT).toBeUndefined()
    expect(h.bridge).toEqual([READY.url])
    expect(h.surface.status).toEqual({ state: 'ready' })
  })

  it('restarts a sidecar that failed after ready, with backoff', async () => {
    const h = harness(['ready', 'ready'])
    await h.surface.start()
    h.created[0]?.options.onFailure?.(new Error('crashed'))
    await settle()
    expect(h.created[0]?.stop).toHaveBeenCalled()
    expect(h.delays).toEqual([COMPOSER_RESTART_DELAYS_MS[0]])
    expect(h.created).toHaveLength(2)
    expect(h.bridge).toEqual([READY.url, undefined, READY.url])
    expect(h.surface.status).toEqual({ state: 'ready' })
    expect(await h.surface.call('get_settings', {})).toEqual({ ok: 1 })
  })

  it('gives up after the restart budget and restores client routing', async () => {
    const h = harness(['fail', 'fail', 'fail', 'fail'])
    await expect(h.surface.start()).rejects.toThrow('start 0 failed')
    await settle()
    expect(h.delays).toEqual([...COMPOSER_RESTART_DELAYS_MS])
    // Four serving attempts, then one restore-only sidecar.
    expect(h.created).toHaveLength(5)
    expect(h.created[4]?.restore).toHaveBeenCalledOnce()
    expect(h.surface.status).toMatchObject({ state: 'failed', codexRestartRequired: true })
    expect(await h.surface.call('get_settings', {})).toEqual({ bridgeError: { code: 'app_not_ready', retryable: false } })
    await expect(h.surface.retry()).rejects.toThrow()
    expect(h.created.length).toBeGreaterThan(5)
  })

  it('reports a failed restore on give-up', async () => {
    const h = harness(['fail', 'fail', 'fail', 'fail'], 'fail')
    await h.surface.start().catch(() => undefined)
    await settle()
    expect(h.surface.status).toMatchObject({ state: 'failed', restoreError: new Error('restore-failed') })
    expect(h.errors.map(error => error.message)).toContain('restore-failed')
  })

  it('refreshes the restart budget after a healthy run', async () => {
    const h = harness(['ready', 'ready', 'ready'])
    await h.surface.start()
    h.created[0]?.options.onFailure?.(new Error('first'))
    await settle()
    h.tick(120_000)
    h.created[1]?.options.onFailure?.(new Error('second'))
    await settle()
    expect(h.delays).toEqual([COMPOSER_RESTART_DELAYS_MS[0], COMPOSER_RESTART_DELAYS_MS[0]])
  })

  it('stops the live sidecar on close and ignores later failures', async () => {
    const h = harness(['ready'])
    await h.surface.start()
    await h.surface.close()
    expect(h.created[0]?.stop).toHaveBeenCalled()
    h.created[0]?.options.onFailure?.(new Error('late'))
    await settle()
    expect(h.created).toHaveLength(1)
    expect(h.bridge.at(-1)).toBeUndefined()
  })
})
