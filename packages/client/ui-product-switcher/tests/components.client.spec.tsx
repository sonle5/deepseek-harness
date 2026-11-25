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
  it('names the current product on a closed trigger and marks the current row in the menu', () => {
    const onChange = vi.fn()
    render(<ProductControl value="composer" label="Switch product" superharness="Superharness" composer="Composer" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Switch product' })
    expect(trigger.textContent).toContain('Composer')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // Closed: no rows are in the document at all.
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const rows = screen.getAllByRole('menuitem')
    expect(rows.map(row => row.textContent)).toEqual(['Superharness', 'Composer'])
    // The current product carries the selection marker, the other does not.
    // The marker is the shared MenuRow check icon, which is also what a
    // screen-reader user hears as the row's checked state.
    expect(rows[1]!.querySelector('svg[data-icon="dsw-icon-check-outline-regular"]')).toBeTruthy()
    expect(rows[0]!.querySelector('svg[data-icon="dsw-icon-check-outline-regular"]')).toBeNull()
    fireEvent.click(rows[0]!)
    expect(onChange.mock.calls).toEqual([['superharness']])
    // Choosing closes the menu again.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('reports the product the user chose, including a repeat of the current one', () => {
    // Main turns a repeat into a no-op; the control still reports the press so
    // the two surfaces agree about what was asked for.
    const onChange = vi.fn()
    render(<ProductControl value="superharness" label="Switch product" superharness="Superharness" composer="Composer" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch product' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Superharness' }))
    expect(onChange).toHaveBeenCalledWith('superharness')
  })

  it('closes the menu on Escape without reporting a choice', () => {
    const onChange = vi.fn()
    render(<ProductControl value="composer" label="Switch product" superharness="Superharness" composer="Composer" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Switch product' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders the compact form for the window-chrome seat', () => {
    render(<ProductControl value="superharness" label="Switch product" superharness="Superharness" composer="Composer" onChange={vi.fn()} compact />)
    expect(screen.getByRole('button', { name: 'Switch product' }).className).toMatch(/compact/)
  })

  it('renders the brand form for the sidebar logo row without drawing its own mark', () => {
    render(<ProductControl value="superharness" label="Switch product" superharness="Superharness" composer="Composer" onChange={vi.fn()} brand />)
    expect(screen.getByRole('button', { name: 'Switch product' }).className).toMatch(/brand/)
    // The mark belongs to the sidebar's `sidebar.brand.mark` seat, which sits
    // immediately before this trigger; drawing one here would be a second
    // source for the identity.
    expect(document.querySelector('svg[data-nexus-brand-mark]')).toBeNull()
  })

  it('grows its Menu anchor wrapper in the brand form so the label stays left-aligned', () => {
    // The logo row justifies to `flex-end`. `Menu` renders its anchor inside a
    // shrink-to-fit span, so a trigger carrying `flex: 1 1 auto` alone lets the
    // whole brand group pack against the panel toggle and leaves the nav-icon
    // column empty above every row beneath. The wrapper has to grow instead.
    const { container } = render(
      <ProductControl value="superharness" label="Switch product" superharness="Superharness" composer="Composer" onChange={vi.fn()} brand />,
    )
    const wrapper = screen.getByRole('button', { name: 'Switch product' }).parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper).toBe(container.firstElementChild)
    expect(wrapper?.className).toMatch(/seat/)
  })

  it('leaves the compact form shrink-to-fit in the window-chrome row', () => {
    const { container } = render(
      <ProductControl value="superharness" label="Switch product" superharness="Superharness" composer="Composer" onChange={vi.fn()} compact />,
    )
    expect(container.firstElementChild?.className).not.toMatch(/seat/)
  })
})

describe('LeadingProductSwitcher', () => {
  it('subscribes to the live product and forwards a choice', () => {
    let snapshot: ProductSwitcherSnapshot = { product: 'superharness', state: state() }
    const select = vi.fn()
    const props = {
      useSwitcher: (selector: (value: ProductSwitcherSnapshot) => unknown) => selector(snapshot),
      select,
      t: makeTranslate(en),
    } as unknown as LeadingProductSwitcherProps
    const view = render(<LeadingProductSwitcher {...props} />)
    const trigger = screen.getByRole('button', { name: en['trigger.label'] })
    expect(trigger.className).toMatch(/compact/)
    expect(trigger.textContent).toContain(en['product.superharness'])
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: en['product.composer'] }))
    expect(select).toHaveBeenCalledWith('composer')
    // A pushed product renames the closed trigger.
    snapshot = { product: 'composer', state: state() }
    view.rerender(<LeadingProductSwitcher {...props} />)
    expect(screen.getByRole('button', { name: en['trigger.label'] }).textContent).toContain(en['product.composer'])
  })
})

describe('ComposerSurface', () => {
  it('draws no chrome of its own and reports the region bounds, tracking resizes', async () => {
    const observer = stubResizeObserver()
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    const region = screen.getByRole('region', { name: en['region.label'] })
    // Composer occupies the frame's center column; the switcher and the drag
    // rows belong to the shared shell, so the surface draws neither.
    expect(document.querySelector('[data-window-drag]')).toBeNull()
    expect(screen.queryByRole('button', { name: en['trigger.label'] })).toBeNull()
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 4, y: 0, width: 800, height: 600, top: 0, left: 4, right: 804, bottom: 600, toJSON: () => ({}) })
    // show runs on mount; re-run its effect body by remounting is unnecessary —
    // the resize path is what carries the measured rectangle.
    observer.fire()
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(props.setBounds).toHaveBeenCalledWith({ x: 4, y: 0, width: 800, height: 600 })
  })

  it('reserves the frame chrome band while the leading seat is mounted', async () => {
    stubResizeObserver()
    // The collapsed desktop sidebar mounts the frame's shell.leading seat over
    // the top-left corner — where the traffic lights and the reopen control
    // are. Native views paint over the document, so the reported rectangle
    // starts below that band instead of hiding it.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { getPropertyValue: (property: string) => (property === '--dsh-frame-top-clearance' ? '48px' : '') } as unknown as CSSStyleDeclaration,
    )
    const seat = document.createElement('div')
    seat.setAttribute('data-shell-leading', '')
    document.body.append(seat)
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    const region = screen.getByRole('region', { name: en['region.label'] })
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(props.setBounds).toHaveBeenCalledWith({ x: 0, y: 48, width: 800, height: 552 })
    seat.remove()
  })

  it('reserves no band when the frame declares an unusable clearance', async () => {
    stubResizeObserver()
    // The seat is mounted but the custom property is absent (or not a number,
    // as during a stylesheet swap). An unparseable value must reserve nothing
    // rather than produce NaN bounds, which the main process would reject.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration,
    )
    const seat = document.createElement('div')
    seat.setAttribute('data-shell-leading', '')
    document.body.append(seat)
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    const region = screen.getByRole('region', { name: en['region.label'] })
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(props.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 800, height: 600 })
    seat.remove()
  })

  it('yields to a narrow-window sidebar drawer and reattaches when it closes', async () => {
    stubResizeObserver()
    // The drawer is document content sliding over the center column. A native
    // view paints above the document, so it would bury the sidebar the user
    // just opened; the view detaches while the drawer is open.
    const frame = document.createElement('div')
    frame.setAttribute('data-sidebar-drawer', '')
    frame.setAttribute('data-sidebar-collapsed', '')
    document.body.append(frame)
    const props = surfaceProps()
    render(<ComposerSurface {...props} />)
    expect(props.show).toHaveBeenCalledTimes(1)
    act(() => { frame.removeAttribute('data-sidebar-collapsed') })
    await act(async () => {})
    expect(props.hide).toHaveBeenCalledTimes(1)
    act(() => { frame.setAttribute('data-sidebar-collapsed', '') })
    await act(async () => {})
    expect(props.show).toHaveBeenCalledTimes(2)
    frame.remove()
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

  it('falls back to the main element when no sidebar frame carries the drawer flags', async () => {
    stubResizeObserver()
    // `frameElement` looks for the workspace frame by its sidebar attributes and
    // falls back to `<main>`/`#root` — a narrow window without a workspace, or
    // the settings surface, still has a frame to observe for presentation
    // changes. Without the fallback, a drawer toggled there would never detach
    // the view.
    const frame = document.createElement('main')
    document.body.append(frame)
    const props = surfaceProps()
    const view = render(<ComposerSurface {...props} />)
    expect(props.show).toHaveBeenCalledTimes(1)
    // Presentation changes on the fallback frame are observed too, so a drawer
    // opened later still detaches.
    act(() => { frame.setAttribute('data-sidebar-drawer', ''); frame.setAttribute('data-sidebar-collapsed', '') })
    act(() => { frame.removeAttribute('data-sidebar-collapsed') })
    await act(async () => {})
    expect(props.hide).toHaveBeenCalledTimes(1)
    view.unmount()
    frame.remove()
  })

  it('does not report bounds for a resize while the view is detached', async () => {
    // A ResizeObserver entry can arrive while the placeholder owns the column —
    // Composer failed, so there is no view to bound. `setBounds` then addresses
    // a view nobody is showing, and main would log it as an unexpected command.
    const observer = stubResizeObserver()
    const props = surfaceProps({ state: state({ status: 'failed', visible: false }) })
    render(<ComposerSurface {...props} />)
    expect(props.show).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('resize')) })
    observer.fire()
    expect(props.setBounds).not.toHaveBeenCalled()
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

  it('ignores a rejected hide when a drawer detaches the view', async () => {
    // The same rejection, reached through the detach path rather than unmount:
    // main may have already removed the view because the window is tearing
    // down, and that must not surface as an unhandled rejection.
    stubResizeObserver()
    const frame = document.createElement('div')
    frame.setAttribute('data-sidebar-drawer', '')
    frame.setAttribute('data-sidebar-collapsed', '')
    document.body.append(frame)
    const hide = vi.fn(() => Promise.reject(new Error('window closing')))
    const props = surfaceProps({ hide })
    render(<ComposerSurface {...props} />)
    expect(props.show).toHaveBeenCalledTimes(1)
    act(() => { frame.removeAttribute('data-sidebar-collapsed') })
    await act(async () => {})
    expect(hide).toHaveBeenCalledTimes(1)
    frame.remove()
  })

  it('switches back to Superharness from a sidebar control, not from the surface', () => {
    stubResizeObserver()
    render(<ComposerSurface {...surfaceProps()} />)
    // The surface carries no switcher: the sidebar's and the frame's seats are
    // the one place the product is chosen, and they stay mounted.
    expect(screen.queryByRole('button', { name: en['trigger.label'] })).toBeNull()
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
