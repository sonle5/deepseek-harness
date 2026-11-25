// @vitest-environment jsdom
/** Plugin activation, gating, selection, bounds, and failure handling over a fake bridge. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { DshComposerBridge, ComposerSwitcherState } from '../src/client/composer-bridge.ts'
import { readComposerBridge } from '../src/client/composer-bridge.ts'
import { apply as applyHost } from '../src/index.ts'
import { apply as applyPlugin, inject as pluginInject } from '../src/client/index.ts'

/** The plugin entrypoint, hoisted so mounting does not hand an inline async function to a void-shaped property. */
const PLUGIN = { inject: [...pluginInject], apply: applyPlugin }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

/** localStorage key the plugin saves the selected product under. */
const PRODUCT_KEY = 'dsh.productSwitcher.product'

/** A ready, available state; a case overrides what it exercises. */
function ready(overrides: Partial<ComposerSwitcherState> = {}): ComposerSwitcherState {
  return { available: true, status: 'ready', visible: false, ...overrides }
}

/** A bridge whose state and commands the test drives; every command resolves by default. */
function fakeBridge(initial: ComposerSwitcherState = ready()) {
  let listener: ((state: ComposerSwitcherState) => void) | undefined
  let selectListener: ((product: 'superharness' | 'composer' | 'toggle') => void) | undefined
  const bridge = {
    protocolVersion: 1 as const,
    state: vi.fn(async () => initial),
    subscribe: vi.fn((next: (state: ComposerSwitcherState) => void) => { listener = next; return () => { listener = undefined } }),
    show: vi.fn(async (_bounds: { x: number; y: number; width: number; height: number }) => {}),
    setBounds: vi.fn(async (_bounds: { x: number; y: number; width: number; height: number }) => {}),
    hide: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    navigate: vi.fn(async (_request: { readonly view: string; readonly app?: 'codex' | 'vscode' | 'claude' }) => {}),
    onSelect: vi.fn((next: (product: 'superharness' | 'composer' | 'toggle') => void) => { selectListener = next; return () => { selectListener = undefined } }),
  } satisfies DshComposerBridge
  return {
    bridge,
    push: (next: ComposerSwitcherState) => { act(() => { listener?.(next) }) },
    selectFromMain: (product: 'superharness' | 'composer' | 'toggle') => { act(() => { selectListener?.(product) }) },
    hasSelectListener: () => selectListener !== undefined,
  }
}

/** Minimal ResizeObserver double; nothing fires unless the test asks. */
function stubResizeObserver(): { fire(): void } {
  let callback: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class {
    constructor(next: () => void) { callback = next }
    observe(): void {}
    disconnect(): void {}
  })
  return { fire: () => { act(() => { callback?.() }) } }
}

/** Declare the seats the plugin fills, so its `slots.inject` registrations run. */
async function declareSeats(runtime: SlotTestRuntime): Promise<void> {
  await runtime.declare({
    'sidebar.product': { kind: 'single', scope: 'root' },
    'sidebar.leading.product': { kind: 'single', scope: 'root' },
    'sidebar.navigation': { kind: 'hoc', scope: 'root' },
    'main': { kind: 'keyed', scope: 'root' },
  })
}

/** A layout double recording panel selections, so the tests need no real frame. */
function stubLayout(runtime: SlotTestRuntime) {
  const selectPanel = vi.fn((id: string | null) => { runtime.panelInfo.set({ activePanelId: id as never }) })
  runtime.ctx.provide('layout', {
    panelInfo: runtime.panelInfo,
    selectPanel,
    beginNavigation: () => new AbortController().signal,
    toggleSidebar: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  })
  return { selectPanel }
}

/** Mount the runtime with locale, layout and declared seats; returns the runtime and the owner. */
async function bench(bridge: DshComposerBridge) {
  vi.stubGlobal('dshComposer', bridge)
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await declareSeats(runtime)
  const layout = stubLayout(runtime)
  const owner = await runtime.mount(PLUGIN)
  return { runtime, owner, layout }
}

it('keeps the Host entry empty', () => { applyHost() })

it('reads only protocol 1 bridges', () => {
  expect(readComposerBridge({})).toBeUndefined()
  expect(readComposerBridge({ dshComposer: { protocolVersion: 2 } })).toBeUndefined()
  const bridge = fakeBridge().bridge
  expect(readComposerBridge({ dshComposer: bridge })).toBe(bridge)
})

it('registers nothing without a bridge', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await declareSeats(runtime)
  stubLayout(runtime)
  const owner = await runtime.mount(PLUGIN)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.leading.product')).toHaveLength(0)
  expect(runtime.slots.entries('main')).toHaveLength(0)
  await owner.dispose()
})

it('registers nothing when the build embeds no usable Composer', async () => {
  const fake = fakeBridge(ready({ available: false }))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('main')).toHaveLength(0)
  expect(fake.bridge.subscribe).not.toHaveBeenCalled()
})

it('stops quietly when the state read rejects', async () => {
  const fake = fakeBridge()
  fake.bridge.state.mockImplementationOnce(() => Promise.reject(new Error('ipc down')))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  // The Cordis logger keeps its records in its own buffer; the message names
  // the failing read and the underlying error follows it.
  const errors = runtime.ctx.logger.buffer.filter(message => message.type === 'error')
  expect(errors).toHaveLength(1)
  expect(errors[0]!.args[0]).toBe('product switcher: reading the Composer state failed')
  expect((errors[0]!.args[1] as Error).message).toBe('ipc down')
})

/** Mount the plugin without waiting for activation, so a pending read can race disposal. */
async function mountUnawaited(bridge: DshComposerBridge) {
  vi.stubGlobal('dshComposer', bridge)
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await declareSeats(runtime)
  stubLayout(runtime)
  const fiber = runtime.ctx.plugin(PLUGIN)
  return { runtime, fiber }
}

it('ignores a state rejection that lands after the document unloaded', async () => {
  const pending = Promise.withResolvers<ComposerSwitcherState>()
  const fake = fakeBridge()
  fake.bridge.state.mockImplementationOnce(() => pending.promise)
  const { runtime, fiber } = await mountUnawaited(fake.bridge)
  await vi.waitFor(() => { expect(fake.bridge.state).toHaveBeenCalledOnce() })
  const disposal = fiber.dispose()
  pending.reject(new Error('ipc down'))
  await disposal
  expect(runtime.ctx.logger.buffer.filter(message => message.type === 'error')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
})

it('ignores a state that lands after the document unloaded', async () => {
  const pending = Promise.withResolvers<ComposerSwitcherState>()
  const fake = fakeBridge()
  fake.bridge.state.mockImplementationOnce(() => pending.promise)
  const { runtime, fiber } = await mountUnawaited(fake.bridge)
  await vi.waitFor(() => { expect(fake.bridge.state).toHaveBeenCalledOnce() })
  const disposal = fiber.dispose()
  pending.resolve(ready())
  await disposal
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(fake.bridge.subscribe).not.toHaveBeenCalled()
})

it('registers three surfaces and removes them on dispose', async () => {
  const fake = fakeBridge()
  const { runtime, owner } = await bench(fake.bridge)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(1)
  expect(runtime.slots.entries('sidebar.leading.product')).toHaveLength(1)
  expect(runtime.slots.entries('sidebar.navigation')).toHaveLength(1)
  expect(runtime.slots.entries('main')).toHaveLength(1)
  expect(runtime.slots.entries('main')[0]!.options.key).toBe('composer')
  expect(fake.bridge.subscribe).toHaveBeenCalledTimes(1)
  expect(fake.bridge.onSelect).toHaveBeenCalledTimes(1)
  await owner.dispose()
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.leading.product')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.navigation')).toHaveLength(0)
  expect(runtime.slots.entries('main')).toHaveLength(0)
})

it('selects the Composer panel from a sidebar control, attaching the view to the column', async () => {
  const resize = stubResizeObserver()
  const fake = fakeBridge()
  const { runtime, layout } = await bench(fake.bridge)
  const sidebar = runtime.renderSlot('sidebar.product', {})
  // The panel is mounted by the frame's keyed slot; selecting it is what shows
  // the surface, exactly as for any other global panel.
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  expect(panel.view.queryByRole('region', { name: 'Composer view' })).toBeNull()
  const trigger = sidebar.view.getByRole('button', { name: 'Switch product' })
  expect(trigger.textContent).toContain('Superharness')
  fireEvent.click(trigger)
  // The menu portals out of the sidebar's clipped logo row, so it is found on
  // the document rather than inside the seat's container.
  fireEvent.click(screen.getByRole('menuitem', { name: 'Composer' }))
  // Choosing closed the menu and selected the panel.
  expect(screen.queryByRole('menu')).toBeNull()
  expect(layout.selectPanel).toHaveBeenCalledWith('composer')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
  // The surface occupies the center column: no window bar, no second switcher.
  const region = panel.view.getByRole('region', { name: 'Composer view' })
  expect(document.querySelector('[data-window-drag]')).toBeNull()
  vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 0, width: 900, height: 700, top: 0, left: 280, right: 1180, bottom: 700, toJSON: () => ({}) })
  expect(fake.bridge.show).toHaveBeenCalledTimes(1)
  resize.fire()
  act(() => { window.dispatchEvent(new Event('resize')) })
  // The rectangle is the center column's, not the window's: x starts after the
  // sidebar, and the shared chrome stays outside it.
  expect(fake.bridge.setBounds).toHaveBeenCalledWith({ x: 280, y: 0, width: 900, height: 700 })
  // Switching back from the sidebar's control (still mounted beside the panel)
  // returns to the Conversation and detaches the view.
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Superharness' }))
  await act(async () => {})
  expect(layout.selectPanel).toHaveBeenCalledWith(null)
  expect(fake.bridge.hide).toHaveBeenCalledTimes(1)
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBeNull()
})

it('mirrors Composer navigation in the sidebar only while Composer is the product', async () => {
  const navigation = {
    views: [
      { id: 'providers', label: 'Providers' },
      { id: 'skills', label: 'Skills', app: 'codex' as const },
    ],
    current: 'providers',
    app: 'codex' as const,
  }
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  const seat = runtime.renderSlot('sidebar.navigation', { wide: true }, { children: <div data-testid="shell-rows" /> })

  // No navigation published yet: the shell's own browsing region stands, so the
  // sidebar is never empty while the sidecar starts.
  expect(seat.view.getByTestId('shell-rows')).toBeTruthy()
  expect(seat.view.queryByRole('navigation')).toBeNull()

  // Navigation published, but Composer is not the product: still the shell's
  // rows. Publishing alone must not take over Superharness's sidebar.
  fake.push(ready({ navigation }))
  expect(seat.view.getByTestId('shell-rows')).toBeTruthy()
  expect(seat.view.queryByRole('navigation')).toBeNull()

  // Composer is the product and has published: its rows replace the shell's.
  const sidebar = runtime.renderSlot('sidebar.product', {})
  fireEvent.click(sidebar.view.getByRole('button', { name: 'Switch product' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Composer' }))
  const nav = seat.view.getByRole('navigation', { name: 'Composer navigation' })
  expect(seat.view.queryByTestId('shell-rows')).toBeNull()
  expect(nav.textContent).toContain('Providers')
  expect(nav.textContent).toContain('Skills')
  // The published `current` view is the only one marked current, even though
  // both rows share an id space.
  expect(seat.view.getByRole('button', { name: 'Providers' }).getAttribute('aria-current')).toBe('page')
  expect(seat.view.getByRole('button', { name: 'Skills' }).getAttribute('aria-current')).toBeNull()

  // A press routes back to Composer with the view's tab.
  fireEvent.click(seat.view.getByRole('button', { name: 'Skills' }))
  expect(fake.bridge.navigate).toHaveBeenCalledWith({ view: 'skills', app: 'codex' })

  // Back to Superharness: the shell's own rows return.
  fake.selectFromMain('superharness')
  expect(seat.view.getByTestId('shell-rows')).toBeTruthy()
  expect(seat.view.queryByRole('navigation')).toBeNull()
})

it('shapes Composer navigation as a rail when the sidebar collapses', async () => {
  const navigation = {
    views: [{ id: 'providers', label: 'Providers' }],
    current: 'providers',
    app: 'codex' as const,
  }
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  fake.push(ready({ navigation }))
  fake.selectFromMain('composer')

  // Wide: the label is drawn beside the glyph, and each row is reachable by name.
  const wide = runtime.renderSlot('sidebar.navigation', { wide: true }, { children: null })
  expect(wide.view.getByRole('navigation').textContent).toContain('Providers')

  // Rail: the 56px column drops labels, so the glyph must remain — a row with
  // no glyph would be an empty, still-focusable button.
  const rail = runtime.renderSlot('sidebar.navigation', { wide: false }, { children: null })
  const row = rail.view.getByRole('button', { name: 'Providers' })
  expect(row.querySelector('svg')).not.toBeNull()
  expect(rail.view.getByRole('navigation').textContent).not.toContain('Providers')
})

it('falls back to a neutral glyph and routes a view without a tab', async () => {
  // Composer publishes its own view ids. One this shell does not know must
  // still get a row — an unknown id is a version skew, not a reason to drop the
  // user's navigation — and a view that belongs to no tab must navigate without
  // one rather than invent `app: undefined` on the wire.
  const navigation = {
    views: [
      { id: 'providers', label: 'Providers' },
      { id: 'something-new', label: 'Something New' },
    ],
    current: 'providers',
    app: 'codex' as const,
  }
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  fake.push(ready({ navigation }))
  fake.selectFromMain('composer')
  const seat = runtime.renderSlot('sidebar.navigation', { wide: true }, { children: null })
  // The unknown id still has a glyph, so the rail is never a blank button.
  const unknown = seat.view.getByRole('button', { name: 'Something New' })
  expect(unknown.querySelector('svg')).not.toBeNull()
  fireEvent.click(unknown)
  expect(fake.bridge.navigate).toHaveBeenCalledWith({ view: 'something-new' })
})

it('marks only the tab-scoped row whose tab is current', async () => {
  // Skills exists under both tabs; matching on id alone would light up both
  // rows at once. The tab is part of the row's identity.
  const navigation = {
    views: [
      { id: 'skills', label: 'Codex Skills', app: 'codex' as const },
      { id: 'skills', label: 'Claude Skills', app: 'claude' as const },
    ],
    current: 'skills',
    app: 'claude' as const,
  }
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  fake.push(ready({ navigation }))
  fake.selectFromMain('composer')
  const seat = runtime.renderSlot('sidebar.navigation', { wide: true }, { children: null })
  expect(seat.view.getByRole('button', { name: 'Codex Skills' }).getAttribute('aria-current')).toBeNull()
  expect(seat.view.getByRole('button', { name: 'Claude Skills' }).getAttribute('aria-current')).toBe('page')
})

it('draws the compact switcher in the window-chrome seat, following main', async () => {
  // The leading seat is the window-chrome copy of the switcher: no room for the
  // brand form, so it renders compact and renames itself from the same store.
  // Rendered through the real slot runtime so it receives the seat's actual
  // props rather than a hand-built look-alike.
  const fake = fakeBridge()
  const { runtime, layout } = await bench(fake.bridge)
  const seat = runtime.renderSlot('sidebar.leading.product', {})
  const trigger = seat.view.getByRole('button', { name: 'Switch product' })
  expect(trigger.className).toMatch(/compact/)
  expect(trigger.textContent).toContain('Superharness')
  // A press routes through the same select action as the sidebar's copy, which
  // is what selects the panel — the seat draws no view of its own.
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Composer' }))
  expect(layout.selectPanel).toHaveBeenCalledWith('composer')
  // And it renames itself from main's push, like every other surface.
  fake.selectFromMain('composer')
  expect(seat.view.getByRole('button', { name: 'Switch product' }).textContent).toContain('Composer')
})

it('leaves Composer when another main panel is selected', async () => {
  const resize = stubResizeObserver()
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  const sidebar = runtime.renderSlot('sidebar.product', {})
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  fake.selectFromMain('composer')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
  expect(panel.view.getByRole('region', { name: 'Composer view' })).toBeTruthy()
  // A sidebar entry selects its own panel; Composer yields instead of naming a
  // product the frame is no longer showing.
  act(() => { runtime.panelInfo.set({ activePanelId: 'plugins' as never }) })
  expect(sidebar.view.getByRole('button', { name: 'Switch product' }).textContent).toContain('Superharness')
  await act(async () => {})
  expect(fake.bridge.hide).toHaveBeenCalledTimes(1)
  expect(resize).toBeTruthy()
})

it('follows main selections and ignores a repeat of the current product', async () => {
  stubResizeObserver()
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  const sidebar = runtime.renderSlot('sidebar.product', {})
  const trigger = sidebar.view.getByRole('button', { name: 'Switch product' })
  const current = () => trigger.textContent
  expect(current()).toContain('Superharness')
  fake.selectFromMain('composer')
  expect(current()).toContain('Composer')
  fake.selectFromMain('superharness')
  expect(current()).toContain('Superharness')
  // Re-selecting the current product is a no-op (the overlay stays unmounted).
  fake.selectFromMain('superharness')
  expect(current()).toContain('Superharness')
  fake.selectFromMain('toggle')
  expect(current()).toContain('Composer')
  fake.selectFromMain('toggle')
  expect(current()).toContain('Superharness')
})

it('saves the selected product and restores Composer after a reload', async () => {
  stubResizeObserver()
  const first = fakeBridge()
  const before = await bench(first.bridge)
  first.selectFromMain('composer')
  expect(localStorage.getItem(PRODUCT_KEY)).toBe('composer')
  await before.owner.dispose()

  // The reloaded document finds main still showing the view it attached.
  const fake = fakeBridge(ready({ visible: true }))
  const { runtime } = await bench(fake.bridge)
  const trigger = runtime.renderSlot('sidebar.product', {}).view.getByRole('button', { name: 'Switch product' })
  expect(trigger.textContent).toContain('Composer')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  expect(panel.view.getByRole('region', { name: 'Composer view' })).toBeTruthy()
  expect(fake.bridge.show).toHaveBeenCalledTimes(1)
})

it('names Composer when main shows its view even without a saved choice', async () => {
  stubResizeObserver()
  const fake = fakeBridge(ready({ visible: true }))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.renderSlot('sidebar.product', {}).view.getByRole('button', { name: 'Switch product' }).textContent)
    .toContain('Composer')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
  expect(localStorage.getItem(PRODUCT_KEY)).toBe('composer')
})

it('restores Composer at relaunch, before main has attached any view', async () => {
  stubResizeObserver()
  localStorage.setItem(PRODUCT_KEY, 'composer')
  const fake = fakeBridge(ready({ visible: false }))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
  runtime.renderSlot('main', {}, { entryKey: 'composer' })
  expect(fake.bridge.show).toHaveBeenCalledTimes(1)
})

it('restores Superharness after a reload that left Composer', async () => {
  stubResizeObserver()
  const first = fakeBridge()
  const before = await bench(first.bridge)
  first.selectFromMain('composer')
  first.selectFromMain('superharness')
  expect(localStorage.getItem(PRODUCT_KEY)).toBe('superharness')
  await before.owner.dispose()

  const fake = fakeBridge(ready({ visible: false }))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.renderSlot('sidebar.product', {}).view.getByRole('button', { name: 'Switch product' }).textContent)
    .toContain('Superharness')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBeNull()
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  expect(panel.view.queryByRole('region', { name: 'Composer view' })).toBeNull()
  expect(fake.bridge.show).not.toHaveBeenCalled()
})

it('starts on Superharness when the saved choice is not a product', async () => {
  localStorage.setItem(PRODUCT_KEY, 'chat')
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBeNull()
})

it('keeps the selection when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBeNull()
  fake.selectFromMain('composer')
  expect(runtime.panelInfo.getSnapshot().activePanelId).toBe('composer')
})

it('retries a failed Composer from the surface', async () => {
  stubResizeObserver()
  const fake = fakeBridge(ready({ status: 'starting' }))
  const { runtime } = await bench(fake.bridge)
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  fake.selectFromMain('composer')
  expect(panel.view.getByRole('status').textContent).toBe('Starting Composer…')
  fake.push(ready({ status: 'failed', error: 'boom' }))
  expect(panel.view.getByRole('status').textContent).toBe('Composer could not start.')
  fireEvent.click(panel.view.getByRole('button', { name: 'Retry' }))
  await act(async () => {})
  expect(fake.bridge.retry).toHaveBeenCalledTimes(1)
})

it('shows the running-separately banner pushed by main', async () => {
  stubResizeObserver()
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  const panel = runtime.renderSlot('main', {}, { entryKey: 'composer' })
  fake.selectFromMain('composer')
  fake.push(ready({ ownership: 'external' }))
  expect(panel.view.getByRole('status').textContent).toContain('Running separately')
})

it('unsubscribes from main on dispose', async () => {
  const fake = fakeBridge()
  const { owner } = await bench(fake.bridge)
  expect(fake.hasSelectListener()).toBe(true)
  await owner.dispose()
  expect(fake.hasSelectListener()).toBe(false)
})
