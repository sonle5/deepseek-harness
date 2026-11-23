import { describe, expect, it, vi } from 'vitest'
import type { ComposerSidecarOptions } from '../src/composer-sidecar.ts'

vi.mock('electron', () => ({
  WebContentsView: vi.fn(), session: {}, shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  clipboard: {}, dialog: {},
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
  const sockets: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = []
  const clipboard = { writeText: vi.fn(() => Promise.resolve()) }
  const deferred: Array<() => void> = []
  let clock = 0
  const surface = new DesktopComposerSurface({
    resources: { dist: '/dist', binary: '/bin/composer' }, preload: '/preload.js', home: '/tmp/isolated', ipc: false,
    environment: () => Promise.resolve({ PATH: '/login/bin', NEXUS_COMPOSER_TELEMETRY_CONSENT: 'granted' }),
    onError: (error) => { errors.push(error) },
    onStatus: (status) => { statuses.push(status) },
    onBridgeUrl: (url) => { bridge.push(url) },
    delay: (ms) => { delays.push(ms); return Promise.resolve() },
    now: () => clock,
    shell: { clipboard, defer: (run) => { deferred.push(run) } },
    events: {
      createSocket: (endpoint) => { const socket = { url: endpoint.url, close: vi.fn() }; sockets.push(socket); return socket },
      schedule: () => () => undefined,
    },
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
        release: vi.fn(),
        codexDecision: vi.fn(),
        eventsEndpoint: () => ({ url: `ws://127.0.0.1:${String(4000 + index)}/v1/events`, authorization: 'Bearer s' }),
      }
    },
  })
  return { surface, created, statuses, bridge, errors, delays, sockets, clipboard, deferred, tick: (ms: number) => { clock += ms } }
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

  it('answers shell-owned commands without starting the sidecar', async () => {
    const h = harness(['ready'])
    expect(await h.surface.call('copy_text_to_clipboard', { text: 'hi' })).toEqual({ ok: true })
    expect(h.clipboard.writeText).toHaveBeenCalledWith('hi')
    expect(h.created).toHaveLength(0)
  })

  it('opens one event socket per ready sidecar and closes it with the sidecar', async () => {
    const h = harness(['ready', 'ready'])
    await h.surface.start()
    expect(h.sockets.map(socket => socket.url)).toEqual(['ws://127.0.0.1:4000/v1/events'])
    h.created[0]?.options.onFailure?.(new Error('crashed'))
    await settle()
    expect(h.sockets[0]?.close).toHaveBeenCalled()
    expect(h.sockets.map(socket => socket.url)).toEqual(['ws://127.0.0.1:4000/v1/events', 'ws://127.0.0.1:4001/v1/events'])
    await h.surface.close()
    expect(h.sockets[1]?.close).toHaveBeenCalled()
  })

  it('restart_app replaces the sidecar with a fresh budget, keeping Superharness', async () => {
    const h = harness(['ready', 'ready'])
    await h.surface.start()
    expect(await h.surface.call('restart_app', {})).toEqual({ ok: true })
    expect(h.created).toHaveLength(1)
    h.deferred[0]?.()
    await settle()
    expect(h.created[0]?.stop).toHaveBeenCalledOnce()
    expect(h.created).toHaveLength(2)
    expect(h.sockets[0]?.close).toHaveBeenCalled()
    expect(h.sockets).toHaveLength(2)
    expect(h.bridge).toEqual([READY.url, undefined, READY.url])
    expect(h.surface.status).toEqual({ state: 'ready' })
    expect(h.delays).toEqual([])
    expect(await h.surface.call('get_settings', {})).toEqual({ ok: 1 })
  })
})
