import { describe, expect, it, vi } from 'vitest'
import type { ComposerSurfaceStatus } from '../src/composer-surface.ts'
import type { ComposerBounds } from '../src/composer-view.ts'
import type { ComposerSwitcherEvent, ComposerSwitcherOwner } from '../src/composer-switcher.ts'

/** A channel registration as the switcher installs it; the event is the switcher's own narrow shape. */
type InstalledHandler = (event: ComposerSwitcherEvent, ...args: unknown[]) => unknown

// `vi.hoisted` runs before imports, so the mock members are declared here with
// the handler type the switcher's registrations have — narrower than Electron's
// own, which is what lets the tests call a recorded handler with a fake event.
const electron = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: InstalledHandler) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(),
}))
vi.mock('electron', () => ({
  WebContentsView: vi.fn(), session: {}, shell: { openExternal: vi.fn() },
  ipcMain: electron, clipboard: {}, dialog: {},
}))

const { COMPOSER_SWITCHER_IPC, composerOsCompatible, composerSwitcherState, installComposerSwitcher } =
  await import('../src/composer-switcher.ts')
const { ComposerIncompatibleError } = await import('../src/composer-sidecar.ts')

const ipcMock = electron

/** An Electron `Input` with only the fields the switcher reads set meaningfully. */
function key(code: string, modifiers: Partial<Record<'control' | 'alt' | 'shift' | 'meta', boolean>>)
  : Electron.Input {
  return {
    type: 'keyDown', key: '', code, control: false, alt: false, shift: false, meta: false,
    isAutoRepeat: false, isComposing: false, location: 0, modifiers: [], ...modifiers,
  }
}

function owner(url = 'dsh-app://app/') {
  const mainFrame = { url }
  const webContents = { send: vi.fn(), mainFrame, getZoomFactor: vi.fn(() => 1) }
  // Typed as the switcher's own owner share: the fake carries exactly the
  // members it reads, so no assertion into Electron's full BrowserWindow is
  // needed, and a new member on the share shows up here as a type error.
  const window = {
    isDestroyed: () => false, webContents, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  } satisfies ComposerSwitcherOwner
  return window
}

function harness(overrides: { configured?: boolean; osRelease?: string; platform?: NodeJS.Platform; noSurface?: boolean } = {}) {
  // Widened at the boundary: Electron's real BrowserWindow/view carry far more
  // members than a fake needs, and the switcher only touches these few.
  const view = {
    visible: false as boolean,
    owner: undefined as ReturnType<typeof owner> | undefined,
    bounds: undefined as ComposerBounds | undefined,
    show: vi.fn((target: ReturnType<typeof owner>, area: ComposerBounds) => {
      view.owner = target; view.visible = true; view.bounds = area
    }),
    hide: vi.fn(() => { view.visible = false; view.owner = undefined }),
  }
  const surface = {
    status: { state: 'idle' } as ComposerSurfaceStatus,
    ready: undefined as { version: string; ownership: string } | undefined,
    view,
    start: vi.fn(() => { surface.status = { state: 'starting' }; return Promise.resolve() }),
    retry: vi.fn(() => { surface.status = { state: 'starting' }; return Promise.resolve() }),
  }
  let window: ReturnType<typeof owner> | undefined = owner()
  let blocked = false
  const raiseOverlays = vi.fn()
  const switcher = installComposerSwitcher({
    configured: overrides.configured ?? true,
    osRelease: overrides.osRelease ?? '23.0.0',
    platform: overrides.platform ?? 'darwin',
    // `window` already satisfies the owner share, so it needs no assertion.
    window: () => window,
    surface: () => overrides.noSurface === true ? undefined : surface,
    blocked: () => blocked,
    raiseOverlays,
  })
  /** The most recent registration for `channel`, as the switcher installed it. */
  const handler = (channel: string): InstalledHandler => {
    // Handler registrations accumulate across harnesses; the newest install owns the channel.
    const registered = ipcMock.handle.mock.calls.filter(([name]) => name === channel)
    const call = registered[registered.length - 1]
    if (call === undefined) throw new Error(`no handler for ${channel}`)
    return call[1]
  }
  const event = (target = window, url?: string) => {
    if (target === undefined) return { sender: {}, senderFrame: null }
    const frame = target.webContents.mainFrame
    return { sender: target.webContents, senderFrame: url === undefined ? frame : { url } }
  }
  // A stand-in for Electron's before-input-event argument, which the switcher reads only these from.
  const keyEvent = (): { preventDefault: ReturnType<typeof vi.fn<() => void>>; defaultPrevented: boolean } =>
    ({ preventDefault: vi.fn<() => void>(), defaultPrevented: false })
  return {
    surface, view, switcher, handler, event, keyEvent, raiseOverlays,
    setWindow: (next: ReturnType<typeof owner> | undefined) => { window = next },
    getWindow: () => window,
    setBlocked: (next: boolean) => { blocked = next },
    changed: (): unknown[] => {
      const send = window?.webContents.send
      if (send === undefined) return []
      // `send` is already the mock the owner declares, so its calls are typed.
      const { calls } = vi.mocked(send).mock
      // Electron types forwarded arguments as `any[]`; the payloads are still
      // opaque to the test, so they are widened to `unknown` rather than passed on.
      return calls.filter(([channel]) => channel === COMPOSER_SWITCHER_IPC.changed).map(([, state]): unknown => state)
    },
  }
}

describe('composer switcher availability', () => {
  it('requires macOS 14 (Darwin 23) and never restricts other platforms', () => {
    expect(composerOsCompatible('23.0.0', 'darwin')).toBe(true)
    expect(composerOsCompatible('24.1.0', 'darwin')).toBe(true)
    expect(composerOsCompatible('22.6.0', 'darwin')).toBe(false)
    expect(composerOsCompatible('garbage', 'darwin')).toBe(false)
    expect(composerOsCompatible('20.0.0', 'win32')).toBe(true)
    expect(composerOsCompatible('20.0.0', 'linux')).toBe(true)
  })
})

describe('composer switcher state', () => {
  const surface = (status: ComposerSurfaceStatus, ready?: { version: string; ownership: string }, visible = false) =>
    ({ status, ready, view: { visible, owner: undefined, show: vi.fn(), hide: vi.fn() }, start: vi.fn(), retry: vi.fn() })

  it('reports unavailable without a surface', () => {
    expect(composerSwitcherState(undefined, false, false))
      .toEqual({ available: false, status: 'idle', visible: false })
  })

  it('carries ready facts and visibility', () => {
    expect(composerSwitcherState(surface({ state: 'ready' }, { version: '1.2.3', ownership: 'owner' }, true), true, true))
      .toEqual({ available: true, status: 'ready', ownership: 'owner', version: '1.2.3', visible: true })
  })

  it('drops an unknown ownership but keeps the version', () => {
    expect(composerSwitcherState(surface({ state: 'ready' }, { version: '1.2.3', ownership: 'weird' }), true, false))
      .toEqual({ available: true, status: 'ready', version: '1.2.3', visible: false })
  })

  it('maps restart attempts and failures', () => {
    expect(composerSwitcherState(surface({ state: 'restarting', attempt: 2, error: new Error('crashed') }), true, true))
      .toEqual({ available: true, status: 'restarting', attempt: 2, error: 'crashed', visible: true })
    const incompatible = new ComposerIncompatibleError('nexus composer sidecar speaks bridge protocol 2, expected 1')
    expect(composerSwitcherState(
      surface({ state: 'failed', error: incompatible, codexRestartRequired: true }), true, false))
      .toEqual({ available: true, status: 'failed', error: incompatible.message, incompatible: true,
        codexRestartRequired: true, visible: false })
  })
})

describe('composer switcher launch start', () => {
  it('starts an idle surface without a Composer view, so the proxy binds before traffic', () => {
    const h = harness()
    h.switcher.start()
    expect(h.surface.start).toHaveBeenCalledTimes(1)
    // Starting is not showing: no rectangle is known at launch, and the client selects the product later.
    expect(h.view.show).not.toHaveBeenCalled()
  })

  it('starts once, so a launch and a first view never spawn two sidecars', async () => {
    const h = harness()
    h.switcher.start()
    // The real surface reports `starting` synchronously; a second start would double-spawn otherwise.
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 10, height: 10 })
    h.switcher.start()
    expect(h.surface.start).toHaveBeenCalledTimes(1)
  })

  it('leaves a failed surface for the client to retry', () => {
    const h = harness()
    h.surface.status = { state: 'failed', error: new Error('boom') }
    h.switcher.start()
    expect(h.surface.start).not.toHaveBeenCalled()
  })

  it('does nothing without an available surface', () => {
    expect(() => { harness({ noSurface: true, configured: false }).switcher.start() }).not.toThrow()
    const noSurface = harness({ noSurface: true })
    noSurface.switcher.start()
    const unavailable = harness({ configured: false })
    unavailable.switcher.start()
    expect(unavailable.surface.start).not.toHaveBeenCalled()
  })

  it('reports a start failure through the switcher state rather than throwing at launch', async () => {
    const h = harness()
    h.surface.start.mockImplementationOnce(() => Promise.reject(new Error('spawn failed')))
    expect(() => { h.switcher.start() }).not.toThrow()
    await vi.waitFor(() => { expect(h.surface.start).toHaveBeenCalledTimes(1) })
  })
})

describe('composer switcher IPC', () => {
  it('reports state to the application document', async () => {
    const h = harness()
    h.surface.ready = { version: '1', ownership: 'isolated' }
    h.surface.status = { state: 'ready' }
    expect(await h.handler(COMPOSER_SWITCHER_IPC.state)(h.event()))
      .toEqual({ available: true, status: 'ready', ownership: 'isolated', version: '1', visible: false })
  })

  it('rejects another renderer or frame', () => {
    const h = harness()
    expect(() => h.handler(COMPOSER_SWITCHER_IPC.state)(h.event(owner(), 'dsh-app://other/'))).toThrow()
    expect(() => h.handler(COMPOSER_SWITCHER_IPC.state)({ sender: {}, senderFrame: null })).toThrow()
  })

  it('validates bounds before attaching', async () => {
    const h = harness()
    const show = h.handler(COMPOSER_SWITCHER_IPC.show)
    for (const bounds of [undefined, null, {}, { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: Number.NaN, height: 1 }, { x: 0, y: 0, width: 1, height: 100_001 }]) {
      await expect(async () => show(h.event(), bounds)).rejects.toThrow('Invalid Composer bounds')
    }
    expect(h.view.show).not.toHaveBeenCalled()
  })

  it('starts an idle surface, attaches, raises overlays, and publishes', async () => {
    const h = harness()
    const bounds = { x: 0, y: 48, width: 1200.4, height: 800.6 }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), bounds)
    expect(h.surface.start).toHaveBeenCalledTimes(1)
    expect(h.view.show).toHaveBeenCalledWith(h.getWindow(), { x: 0, y: 48, width: 1200, height: 801 })
    expect(h.raiseOverlays).toHaveBeenCalledWith(h.getWindow())
    expect(h.changed().at(-1)).toMatchObject({ visible: true })
  })

  it('does not start a failed surface from show; retry does', async () => {    const h = harness()
    h.surface.status = { state: 'failed', error: new Error('boom') }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 0, width: 10, height: 10 })
    expect(h.surface.start).not.toHaveBeenCalled()
    // The renderer draws the failed state; the native view would only cover it with a dead document.
    expect(h.view.show).not.toHaveBeenCalled()
    expect(h.changed().at(-1)).toMatchObject({ status: 'failed', error: 'boom', visible: false })
    await h.handler(COMPOSER_SWITCHER_IPC.retry)(h.event())
    expect(h.surface.retry).toHaveBeenCalledTimes(1)
  })

  it('re-attaches at the last rectangle when a retry recovers the surface', async () => {
    const h = harness()
    h.surface.status = { state: 'failed', error: new Error('boom') }
    const bounds = { x: 0, y: 48, width: 100, height: 90 }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), bounds)
    h.view.hide()
    await h.handler(COMPOSER_SWITCHER_IPC.retry)(h.event())
    expect(h.view.show).toHaveBeenLastCalledWith(h.getWindow(), bounds)
  })

  // A native view paints above the document, so a surface that leaves `ready`
  // must release the column: the application document draws the placeholder
  // and the Retry action there, and the view would bury both.
  it('releases the column when the surface starts restarting', async () => {
    const h = harness()
    h.surface.ready = { version: '1', ownership: 'owner' }
    h.surface.status = { state: 'ready' }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 100, height: 90 })
    expect(h.view.visible).toBe(true)
    h.surface.status = { state: 'restarting', attempt: 1, error: new Error('crashed') }
    h.switcher.sync()
    expect(h.view.visible).toBe(false)
    expect(h.changed().at(-1)).toMatchObject({ status: 'restarting', attempt: 1, visible: false })
    // Coming back must reattach at the rectangle the renderer asked for.
    h.surface.status = { state: 'ready' }
    h.switcher.sync()
    expect(h.view.visible).toBe(true)
    expect(h.view.show).toHaveBeenLastCalledWith(h.getWindow(), { x: 0, y: 48, width: 100, height: 90 })
  })

  it('releases the column when the surface gives up', async () => {
    const h = harness()
    h.surface.ready = { version: '1', ownership: 'owner' }
    h.surface.status = { state: 'ready' }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 100, height: 90 })
    expect(h.view.visible).toBe(true)
    h.surface.status = { state: 'failed', error: new Error('gave up') }
    h.switcher.sync()
    expect(h.view.visible).toBe(false)
    // The published state is how the document learns to draw its Retry action.
    expect(h.changed().at(-1)).toMatchObject({ status: 'failed', visible: false })
  })

  // A standalone Composer owns routing; the embedded surface is read-only and
  // the document explains that. The native view would hide the explanation.
  it('never covers the column while another Composer owns routing', async () => {
    const h = harness()
    h.surface.ready = { version: '1', ownership: 'external' }
    h.surface.status = { state: 'ready' }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 100, height: 90 })
    expect(h.view.show).not.toHaveBeenCalled()
    expect(h.changed().at(-1)).toMatchObject({ ownership: 'external', visible: false })
    // Moving the remembered rectangle must not attach it either.
    await h.handler(COMPOSER_SWITCHER_IPC.bounds)(h.event(), { x: 0, y: 48, width: 120, height: 90 })
    expect(h.view.show).not.toHaveBeenCalled()
  })

  it('detaches a view that was attached before ownership moved away', async () => {
    const h = harness()
    h.surface.ready = { version: '1', ownership: 'owner' }
    h.surface.status = { state: 'ready' }
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 100, height: 90 })
    expect(h.view.visible).toBe(true)
    // A standalone Composer took routing while this view was up.
    h.surface.ready = { version: '1', ownership: 'external' }
    h.switcher.sync()
    expect(h.view.visible).toBe(false)
  })

  it('keeps a blocking overlay on top by not showing Composer', async () => {
    const h = harness()
    h.setBlocked(true)
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 0, width: 10, height: 10 })
    expect(h.view.show).not.toHaveBeenCalled()
  })

  it('hides without stopping the surface and moves visible bounds', async () => {
    const h = harness()
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 10, height: 10 })
    await h.handler(COMPOSER_SWITCHER_IPC.bounds)(h.event(), { x: 5, y: 48, width: 20, height: 20 })
    expect(h.view.show).toHaveBeenLastCalledWith(h.getWindow(), { x: 5, y: 48, width: 20, height: 20 })
    await h.handler(COMPOSER_SWITCHER_IPC.hide)(h.event())
    expect(h.view.hide).toHaveBeenCalledTimes(1)
    expect(h.surface.status.state).not.toBe('idle')
    expect(h.changed().at(-1)).toMatchObject({ visible: false })
  })

  it('converts zoomed CSS-pixel bounds into window content coordinates', async () => {
    const h = harness()
    h.getWindow()!.webContents.getZoomFactor.mockReturnValue(1.5)
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 10, y: 48, width: 100, height: 90 })
    expect(h.view.show).toHaveBeenLastCalledWith(h.getWindow(), { x: 15, y: 72, width: 150, height: 135 })
  })

  it('reattaches a recreated window at the last rectangle and hides under a blocking overlay', async () => {
    const h = harness()
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 48, width: 100, height: 90 })
    const replacement = owner()
    h.setWindow(replacement)
    h.switcher.sync()
    expect(h.view.show).toHaveBeenLastCalledWith(replacement, { x: 0, y: 48, width: 100, height: 90 })
    h.setBlocked(true)
    h.switcher.sync()
    expect(h.view.hide).toHaveBeenCalled()
    // Releasing the overlay restores the client's selection at the remembered rectangle.
    h.setBlocked(false)
    h.switcher.sync()
    expect(h.view.show).toHaveBeenLastCalledWith(replacement, { x: 0, y: 48, width: 100, height: 90 })
  })

  it('sends product selection only when available', () => {
    const h = harness()
    h.switcher.select('composer')
    expect(h.getWindow()?.webContents.send).toHaveBeenCalledWith(COMPOSER_SWITCHER_IPC.select, 'composer')
    const unavailable = harness({ configured: false })
    unavailable.switcher.select('composer')
    expect(unavailable.getWindow()?.webContents.send).not.toHaveBeenCalled()
  })

  it('forwards the platform switcher accelerators from the Composer view', () => {
    const h = harness()
    const event = h.keyEvent()
    h.switcher.forwardInput(event, key('Digit2', { meta: true }))
    expect(h.getWindow()?.webContents.send).toHaveBeenCalledWith(COMPOSER_SWITCHER_IPC.select, 'composer')
    h.switcher.forwardInput(event, key('Digit1', { meta: true }))
    expect(h.getWindow()?.webContents.send).toHaveBeenLastCalledWith(COMPOSER_SWITCHER_IPC.select, 'superharness')
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    // Control+digit is not the macOS accelerator, and other modifiers never match.
    h.switcher.forwardInput(event, key('Digit1', { control: true }))
    h.switcher.forwardInput(event, key('Digit1', { meta: true, shift: true }))
    h.switcher.forwardInput(event, { ...key('Digit1', { meta: true }), type: 'keyUp' })
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(h.getWindow()?.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('uses Control on Windows and Linux', () => {
    const h = harness({ platform: 'win32', osRelease: '10.0.0' })
    const event = h.keyEvent()
    h.switcher.forwardInput(event, key('Digit2', { control: true }))
    expect(h.getWindow()?.webContents.send).toHaveBeenCalledWith(COMPOSER_SWITCHER_IPC.select, 'composer')
    h.switcher.forwardInput(event, key('Digit2', { meta: true }))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a surface and removes its handlers on dispose', async () => {
    const h = harness()
    h.switcher.publish()
    await h.handler(COMPOSER_SWITCHER_IPC.show)(h.event(), { x: 0, y: 0, width: 1, height: 1 })
    expect(h.getWindow()?.contentView.addChildView).not.toHaveBeenCalled()
    h.switcher.dispose()
    for (const channel of [COMPOSER_SWITCHER_IPC.state, COMPOSER_SWITCHER_IPC.show,
      COMPOSER_SWITCHER_IPC.bounds, COMPOSER_SWITCHER_IPC.hide, COMPOSER_SWITCHER_IPC.retry]) {
      expect(ipcMock.removeHandler.mock.calls.map(([name]) => name)).toContain(channel)
    }
  })
})
