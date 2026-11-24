// @vitest-environment jsdom
/** The product control and the Composer surface, driven by props alone. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ComposerSurface, type ComposerSurfaceProps } from '../src/client/ComposerView.tsx'
import type { ComposerSwitcherState } from '../src/client/composer-bridge.ts'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'
import { ProductControl, LeadingProductSwitcher, type LeadingProductSwitcherProps } from '../src/client/ProductSwitcher.tsx'
import type { ProductSwitcherSnapshot } from '../src/client/contract.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** A ready, owner-routed state; fields a case needs are overridden. */
function state(overrides: Partial<ComposerSwitcherState> = {}): ComposerSwitcherState {
  return { available: true, status: 'ready', visible: true, ...overrides }
}

/** Commands for the surface; each resolves by default. */
function surfaceProps(overrides: Partial<ComposerSurfaceProps> = {}): ComposerSurfaceProps {
  return {
    state: state(),
    t: makeTranslate(en),
    onSelect: vi.fn(),
    show: vi.fn(async () => {}),
    setBounds: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    retryComposer: vi.fn(async () => {}),
    ...overrides,
  }
}

/** Minimal ResizeObserver double that records its callback and only fires when told. */
function stubResizeObserver(): { fire(): void; disconnected(): boolean } {
  let callback: (() => void) | undefined
  let disconnected = false
  vi.stubGlobal('ResizeObserver', class {
    constructor(next: () => void) { callback = next }
    observe(): void {}
    disconnect(): void { disconnected = true }
  })
  return { fire: () => { callback?.() }, disconnected: () => disconnected }
}

describe('ProductControl', () => {
  it('renders a labelled pressed group and reports the pressed segment', () => {
    const onChange = vi.fn()
    render(<ProductControl value="composer" label="Product" superharness="Superharness" composer="Composer" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Product' })
    expect(group).toBeTruthy()
    const [superharness, composer] = screen.getAllByRole('button')
    expect(superharness!.getAttribute('aria-pressed')).toBe('false')
    expect(composer!.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(superharness!)
    fireEvent.click(composer!)
    expect(onChange.mock.calls).toEqual([['superharness'], ['composer']])
  })

  it('renders the compact form for the window-chrome seat', () => {
    render(<ProductControl value="superharness" label="Product" superharness="Superharness" composer="Composer" onChange={vi.fn()} compact />)
    expect(screen.getByRole('group').className).toMatch(/compact/)
  })
})

describe('LeadingProductSwitcher', () => {
  it('subscribes to the live product and forwards a press', () => {
    let snapshot: ProductSwitcherSnapshot = { product: 'superharness', state: state() }
    const select = vi.fn()
    const props = {
      useSwitcher: (selector: (value: ProductSwitcherSnapshot) => unknown) => selector(snapshot),
      select,
      t: makeTranslate(en),
    } as unknown as LeadingProductSwitcherProps
    const view = render(<LeadingProductSwitcher {...props} />)
    const group = screen.getByRole('group', { name: en['group.label'] })
    expect(group.className).toMatch(/compact/)
    fireEvent.click(screen.getByRole('button', { name: en['product.composer'] }))
    expect(select).toHaveBeenCalledWith('composer')
    // A pushed product flips the pressed segment.
    snapshot = { product: 'composer', state: state() }
    view.rerender(<LeadingProductSwitcher {...props} />)
    expect(screen.getByRole('button', { name: en['product.composer'] }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ComposerSurface', () => {
  it('shows the bar, reports the region bounds, and tracks resizes', async () => {
    const observer = stubResizeObserver()
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    const region = screen.getByRole('region', { name: en['region.label'] })
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 4, y: 48, width: 800, height: 600, top: 48, left: 4, right: 804, bottom: 648, toJSON: () => ({}) })
    // show runs on mount; re-run its effect body by remounting is unnecessary —
    // the resize path is what carries the measured rectangle.
    observer.fire()
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(props.setBounds).toHaveBeenCalledWith({ x: 4, y: 48, width: 800, height: 600 })
  })

  it('hides the view on unmount and disconnects its observer', async () => {
    const observer = stubResizeObserver()
    const props = surfaceProps()
    const view = render(<ComposerSurface {...props} />)
    view.unmount()
    expect(props.hide).toHaveBeenCalledTimes(1)
    expect(observer.disconnected()).toBe(true)
    // A late rejection from a torn-down window is not surfaced.
    await act(async () => {})
  })

  it('attaches once even when the parent hands down new command identities', () => {
    // Regression: depending on the command functions re-attached on every state
    // push, and each re-attach published again — a feedback loop that grew the
    // heap until the renderer process died.
    stubResizeObserver()
    const props = surfaceProps()
    const view = render(<ComposerSurface {...props} />)
    for (let push = 0; push < 5; push += 1) {
      view.rerender(<ComposerSurface {...surfaceProps({ state: state() })} />)
    }
    expect(props.show).toHaveBeenCalledTimes(1)
    expect(props.hide).not.toHaveBeenCalled()
  })

  it('ignores a rejected show and a rejected hide', async () => {
    stubResizeObserver()
    const failing = () => Promise.reject(new Error('not yet'))
    const props = surfaceProps({ show: vi.fn(failing), hide: vi.fn(failing), setBounds: vi.fn(failing) })
    const view = render(<ComposerSurface {...props} />)
    act(() => { window.dispatchEvent(new Event('resize')) })
    await act(async () => {})
    view.unmount()
    await act(async () => {})
    expect(props.show).toHaveBeenCalled()
  })

  it('switches back to Superharness from the bar', () => {
    stubResizeObserver()
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en['product.superharness'] }))
    expect(props.onSelect).toHaveBeenCalledWith('superharness')
  })

  it('renders nothing over the region once the view is attached', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps()} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([
    ['starting', en['status.starting']],
    ['idle', en['status.starting']],
  ] as const)('shows the starting copy while %s', (status, message) => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps({ state: state({ status, visible: false }) })} />)
    expect(screen.getByRole('status').textContent).toBe(message)
  })

  it('numbers a restart attempt, defaulting to the first', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps({ state: state({ status: 'restarting', attempt: 3, visible: false }) })} />)
    expect(screen.getByRole('status').textContent).toBe('Restarting Composer (attempt 3)…')
    cleanup()
    render(<ComposerSurface {...surfaceProps({ state: state({ status: 'restarting', visible: false }) })} />)
    expect(screen.getByRole('status').textContent).toBe('Restarting Composer (attempt 1)…')
  })

  it('offers a retry after a plain failure and reports a rejected retry', async () => {
    stubResizeObserver()
    const retryComposer = vi.fn(() => Promise.reject(new Error('still down')))
    render(<ComposerSurface {...surfaceProps({ state: state({ status: 'failed', error: 'boom', visible: false }), retryComposer })} />)
    expect(screen.getByRole('status').textContent).toBe(en['status.failed'])
    fireEvent.click(screen.getByRole('button', { name: en['status.retry'] }))
    await act(async () => {})
    expect(retryComposer).toHaveBeenCalledTimes(1)
  })

  it('does not offer a retry for an incompatible Composer', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps({ state: state({ status: 'failed', incompatible: true, visible: false }) })} />)
    expect(screen.getByRole('status').textContent).toBe(en['status.incompatible'])
    expect(screen.queryByRole('button', { name: en['status.retry'] })).toBeNull()
  })

  it('adds the Codex restart note to a failure', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps({ state: state({ status: 'failed', codexRestartRequired: true, visible: false }) })} />)
    expect(screen.getByRole('status').textContent).toContain(en['status.codexRestart'])
    expect(screen.getByRole('button', { name: en['status.retry'] })).toBeTruthy()
  })

  it('shows the running-separately banner when another Composer owns routing', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps({ state: state({ ownership: 'external', visible: false }) })} />)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain(en['status.external'])
    expect(banner.textContent).toContain(en['status.externalDetail'])
  })

  it('localizes every shipped dictionary', () => {
    for (const dictionary of [zh, ja, es, fr, de, ru, pt]) {
      stubResizeObserver()
      const props = surfaceProps({ t: makeTranslate(dictionary), state: state({ status: 'failed', visible: false }) })
      render(<ComposerSurface {...props} />)
      expect(screen.getByRole('status').textContent).toBe(dictionary['status.failed'])
      cleanup()
    }
  })
})
