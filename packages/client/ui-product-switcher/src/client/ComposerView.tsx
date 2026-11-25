/**
 * The Composer surface: a main panel that hands main the center column's
 * rectangle for the native Composer view.
 *
 * Composer is a main panel rather than a window-covering layer. The frame's
 * `main` keyed slot swaps the center column while the sidebar, the drag rows
 * and the window chrome stay mounted, so both products share one shell: the
 * product switcher in the sidebar logo row is the only switcher, the sidebar
 * keeps working, and the frame does not redraw a bar of its own. The native
 * view covers exactly the column this panel occupies, and nothing is drawn
 * above the frame.
 *
 * When the sidebar is collapsed on Desktop the frame mounts its `shell.leading`
 * seat over the top-left corner — the place the traffic lights and the reopen
 * control occupy. Native views paint above the document, so the reported
 * rectangle starts below that band while the seat is mounted; the seat stays
 * visible and clickable, exactly as it does over every other main panel.
 */
import { useEffect, useRef } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBounds, ComposerSwitcherState } from './composer-bridge.ts'
import type { ProductSwitcherInjected } from './contract.ts'
import css from './ComposerView.module.css'

/** Everything the surface needs, so a component test can drive it without a bridge. */
export interface ComposerSurfaceProps {
  /** Latest state main pushed. */
  state: ComposerSwitcherState
  /** Localized copy of the `productSwitcher` namespace. */
  t: TranslateNS<'productSwitcher'>
  /** @param bounds - view rectangle in CSS px of window content coordinates. */
  show: (bounds: ComposerBounds) => Promise<void>
  /** @param bounds - view rectangle in CSS px of window content coordinates. */
  setBounds: (bounds: ComposerBounds) => Promise<void>
  /** Detach the native view; the sidecar keeps running. */
  hide: () => Promise<void>
  /** Retry a Composer that gave up. */
  retryComposer: () => Promise<void>
}

/**
 * The band the frame's window-chrome seat occupies at the top of the frame,
 * read from the element the frame mounts for it. Zero whenever the seat is not
 * mounted, which is every ordinary layout: the center column then starts clear
 * of the traffic lights.
 * @returns the reserved top inset in CSS px.
 */
function chromeInset(): number {
  if (document.querySelector('[data-shell-leading]') === null) return 0
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')
  return Number.parseFloat(declared) || 0
}

/**
 * The frame element, which carries the sidebar presentation attributes.
 * @returns the frame, or null in a document without one.
 */
function frameElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-sidebar-drawer], [data-sidebar-collapsed]')
    ?? document.querySelector<HTMLElement>('main, #root')
}

/**
 * Whether a narrow-window sidebar drawer currently covers the center column.
 * The drawer is ordinary DOM and slides over the content; a native view paints
 * above the document and would bury it, so the view detaches while it is open.
 * @returns true while the drawer is open.
 */
function drawerOpen(): boolean {
  const frame = frameElement()
  if (frame === null || !frame.hasAttribute('data-sidebar-drawer')) return false
  return !frame.hasAttribute('data-sidebar-collapsed')
}

/**
 * Placeholder occupying the native view's area while it is not attached.
 * @param props - the lifecycle state, the retry action, and localized copy.
 * @returns the progress or failure block, or null when the view is attached.
 */
function LifecycleStatus({ state, retryComposer, t }: Pick<ComposerSurfaceProps, 'state' | 'retryComposer' | 't'>) {
  if (state.status === 'ready') return null
  if (state.status === 'failed') {
    return (
      <div className={css.status}>
        {/* The live region carries only the copy; the action stays outside it. */}
        <div role="status">
          <span className={css.message}>
            {state.incompatible === true ? t('status.incompatible') : t('status.failed')}
          </span>
          {state.codexRestartRequired === true && <span className={css.message}>{t('status.codexRestart')}</span>}
        </div>
        {/* An incompatible pin cannot be fixed by retrying; it needs a Superharness update. */}
        {state.incompatible === true ? null : (
          <Button variant="outline" className={css.retry}
            onClick={() => { void retryComposer().catch(() => { /* the pushed state carries the failure */ }) }}>
            {t('status.retry')}
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className={css.status}>
      <span className={css.progress} role="status">
        <StateDot state="ongoing" size={24} />
        <span className={css.message}>
          {state.status === 'restarting'
            ? t('status.restarting', { attempt: state.attempt ?? 1 })
            : t('status.starting')}
        </span>
      </span>
    </div>
  )
}

/**
 * Whether the native view can cover this column without hiding the document.
 *
 * The view paints above the document, so it is only worth attaching when
 * Composer has a document of its own to show: `starting` loads it against the
 * sidecar coming up, and `ready` is live. `restarting` is a dead document over
 * a restarting sidecar and `failed` has no sidecar at all — here the column
 * belongs to the placeholder and its Retry action. A standalone Composer that
 * owns routing draws the "running separately" notice instead. Main enforces the
 * same rule; this mirror only avoids asking for an attachment it would refuse.
 * @param state - latest state main pushed.
 * @returns true when the view should cover the column.
 */
function attachable(state: ComposerSwitcherState): boolean {
  if (state.status !== 'starting' && state.status !== 'ready') return false
  return state.ownership !== 'external'
}

/**
 * @param props - the lifecycle state, the bridge commands, and localized copy.
 * @returns the center column reserved for the native Composer view.
 */
export function ComposerSurface({ state, t, show, setBounds, hide, retryComposer }: ComposerSurfaceProps) {
  const viewport = useRef<HTMLDivElement>(null)
  // Latest commands, read through a ref so attaching runs once per mount.
  //
  // These must not be effect dependencies: main answers every command with a
  // full state push, which re-renders this document and hands down new function
  // identities. Depending on them re-attached on every push, and each re-attach
  // published again — an IPC feedback loop that grew the heap until the renderer
  // died. Mounting once breaks that cycle.
  const commands = useRef({ show, setBounds, hide })
  commands.current = { show, setBounds, hide }
  // Whether the native view may cover the column, read through a ref so the
  // mount effect can consult the latest state without depending on it.
  const canAttach = attachable(state)
  const canAttachNow = useRef(canAttach)
  canAttachNow.current = canAttach
  // The mount effect installs its attach/detach routine here so a status change
  // can re-run it; the effect itself must not depend on the state, or every
  // pushed state would re-attach and publish again (see the note above).
  const resync = useRef<() => void>(() => {})
  useEffect(() => {
    const element = viewport.current
    /* v8 ignore next -- the panel always renders its viewport before effects run. */
    if (element === null) return
    let attached = false
    const bounds = (): ComposerBounds => {
      const rect = element.getBoundingClientRect()
      // Native views paint above the document, so the frame's window-chrome
      // seat would end up underneath one. Starting the view below the band
      // keeps the traffic lights and the reopen control reachable.
      const inset = chromeInset()
      return { x: rect.x, y: rect.y + inset, width: rect.width, height: Math.max(0, rect.height - inset) }
    }
    // A narrow-window drawer is document content sliding over this column; a
    // native view over it would bury the sidebar the user just opened, so the
    // view yields for as long as the drawer is open. The same holds whenever
    // Composer is not serving: the column then belongs to the placeholder.
    const sync = (): void => {
      if (drawerOpen() || !canAttachNow.current) {
        if (!attached) return
        attached = false
        void commands.current.hide().catch(() => { /* window teardown may remove the IPC receiver */ })
        return
      }
      if (attached) return
      attached = true
      // Failures surface through the state main pushes, so a rejected command
      // never needs a second error path here.
      void commands.current.show(bounds()).catch(() => { /* state carries the failure */ })
    }
    resync.current = sync
    sync()
    const track = (): void => {
      if (!attached) return
      void commands.current.setBounds(bounds()).catch(() => { /* the view may be detaching */ })
    }
    const observer = new ResizeObserver(track)
    observer.observe(element)
    window.addEventListener('resize', track)
    const frame = frameElement()
    let presentation: MutationObserver | undefined
    if (frame !== null) {
      presentation = new MutationObserver(() => { sync() })
      presentation.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-drawer', 'data-sidebar-collapsed'] })
    }
    return () => {
      resync.current = () => {}
      observer.disconnect()
      presentation?.disconnect()
      window.removeEventListener('resize', track)
      void commands.current.hide().catch(() => { /* window teardown may remove the IPC receiver */ })
    }
  }, [])
  // Attach and detach as Composer starts, restarts, gives up or regains
  // ownership. Without this the view would outlive the document it belongs to
  // and keep painting over the placeholder main had just asked us to show.
  useEffect(() => { resync.current() }, [canAttach])
  return (
    <div ref={viewport} className={css.surface} role="region" aria-label={t('region.label')}>
      {/* A standalone Composer owns routing; there is no view to attach here. */}
      {state.ownership === 'external'
        ? (
          <div className={css.banner} role="status">
            <span className={css.bannerTitle}>{t('status.external')}</span>
            <span className={css.bannerDetail}>{t('status.externalDetail')}</span>
          </div>
        )
        : <LifecycleStatus state={state} retryComposer={retryComposer} t={t} />}
    </div>
  )
}

/** Full props of the `main` panel occupant. */
export type ComposerViewProps =
  PropsRuntime<'main'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product/state snapshot, the compose/attach commands, and localized copy.
 * @returns the Composer surface while Composer is selected, else null (the frame keeps the Conversation).
 */
export function ComposerView({ useSwitcher, show, setBounds, hide, retry, t }: ComposerViewProps) {
  const product = useSwitcher(current => current.product)
  const state = useSwitcher(current => current.state)
  if (product !== 'composer') return null
  return <ComposerSurface state={state} t={t}
    show={bounds => show(bounds)} setBounds={bounds => setBounds(bounds)} hide={() => hide()} retryComposer={() => retry()} />
}
