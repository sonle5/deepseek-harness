// @vitest-environment jsdom
/** Plugin activation, gating, selection, bounds, and failure handling over a fake bridge. */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { DshComposerBridge, ComposerSwitcherState } from '../src/client/composer-bridge.ts'
import { readComposerBridge } from '../src/client/composer-bridge.ts'
import { apply as applyHost } from '../src/index.ts'
import { apply as applyPlugin, inject as pluginInject } from '../src/client/index.ts'

/** The plugin entrypoint, hoisted so mounting does not hand an inline async function to a void-shaped property. */
const PLUGIN = { inject: [...pluginInject], apply: applyPlugin }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

/** Declare the three seats the plugin fills, so its `slots.inject` registrations run. */
async function declareSeats(runtime: SlotTestRuntime): Promise<void> {
  await runtime.declare({
    'sidebar.product': { kind: 'single', scope: 'root' },
    'sidebar.leading.product': { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  })
}

/** Mount the runtime with locale and declared seats; returns the runtime and the owner. */
async function bench(bridge: DshComposerBridge) {
  vi.stubGlobal('dshComposer', bridge)
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await declareSeats(runtime)
  const owner = await runtime.mount(PLUGIN)
  return { runtime, owner }
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
  const owner = await runtime.mount(PLUGIN)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.leading.product')).toHaveLength(0)
  expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
  await owner.dispose()
})

it('registers nothing when the build embeds no usable Composer', async () => {
  const fake = fakeBridge(ready({ available: false }))
  const { runtime } = await bench(fake.bridge)
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
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
  expect(runtime.slots.entries('shell.overlay')).toHaveLength(1)
  expect(fake.bridge.subscribe).toHaveBeenCalledTimes(1)
  expect(fake.bridge.onSelect).toHaveBeenCalledTimes(1)
  await owner.dispose()
  expect(runtime.slots.entries('sidebar.product')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.leading.product')).toHaveLength(0)
  expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
})

it('selects Composer from a sidebar control, attaches the view, and hides on return', async () => {
  const resize = stubResizeObserver()
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  const sidebar = runtime.renderSlot('sidebar.product', {})
  runtime.renderSlot('shell.overlay', {})
  const trigger = sidebar.view.getByRole('button', { name: 'Switch product' })
  expect(trigger.textContent).toContain('Superharness')
  fireEvent.click(trigger)
  // The menu portals out of the sidebar's clipped logo row, so it is found on
  // the document rather than inside the seat's container.
  fireEvent.click(screen.getByRole('menuitem', { name: 'Composer' }))
  // Choosing closed the menu.
  expect(screen.queryByRole('menu')).toBeNull()
  // The overlay mounts only then: the bar plus the region main covers.
  const region = screen.getByRole('region', { name: 'Composer view' })
  vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 48, width: 900, height: 700, top: 48, left: 0, right: 900, bottom: 748, toJSON: () => ({}) })
  expect(fake.bridge.show).toHaveBeenCalledTimes(1)
  resize.fire()
  act(() => { window.dispatchEvent(new Event('resize')) })
  expect(fake.bridge.setBounds).toHaveBeenCalledWith({ x: 0, y: 48, width: 900, height: 700 })
  // Switching back from the Composer bar unmounts the overlay and hides the view.
  const overlay = screen.getByRole('region', { name: 'Composer view' }).parentElement!
  fireEvent.click(within(overlay).getByRole('button', { name: 'Switch product' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Superharness' }))
  await act(async () => {})
  expect(fake.bridge.hide).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('region', { name: 'Composer view' })).toBeNull()
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

it('retries a failed Composer from the surface', async () => {
  stubResizeObserver()
  const fake = fakeBridge(ready({ status: 'starting' }))
  const { runtime } = await bench(fake.bridge)
  runtime.renderSlot('shell.overlay', {})
  fake.selectFromMain('composer')
  expect(screen.getByRole('status').textContent).toBe('Starting Composer…')
  fake.push(ready({ status: 'failed', error: 'boom' }))
  expect(screen.getByRole('status').textContent).toBe('Composer could not start.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await act(async () => {})
  expect(fake.bridge.retry).toHaveBeenCalledTimes(1)
})

it('shows the running-separately banner pushed by main', async () => {
  stubResizeObserver()
  const fake = fakeBridge()
  const { runtime } = await bench(fake.bridge)
  runtime.renderSlot('shell.overlay', {})
  fake.selectFromMain('composer')
  fake.push(ready({ ownership: 'external' }))
  expect(screen.getByRole('status').textContent).toContain('Running separately')
})

it('unsubscribes from main on dispose', async () => {
  const fake = fakeBridge()
  const { owner } = await bench(fake.bridge)
  expect(fake.hasSelectListener()).toBe(true)
  await owner.dispose()
  expect(fake.hasSelectListener()).toBe(false)
})
