/**
 * The Composer surface: a non-modal full-window layer that carries the
 * Superharness | Composer control in a 48px bar and hands main the rectangle
 * below that bar for the native Composer view.
 *
 * The layer is deliberately not a dialog: the window stays usable around it
 * (main owns the native view's focus and z-order), Escape does nothing, and the
 * only interactive content is the product control. Main attaches the native
 * view above this layer once `show` resolves; while it starts, restarts or
 * fails, this document renders the placeholder that occupies the same area.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBounds, ComposerProduct, ComposerSwitcherState } from './composer-bridge.ts'
import type { ProductSwitcherInjected } from './contract.ts'
import { ProductControl } from './ProductSwitcher.tsx'
import css from './ComposerView.module.css'

/** Everything the surface needs, so a component test can drive it without a bridge. */
export interface ComposerSurfaceProps {
  /** Latest state main pushed. */
  state: ComposerSwitcherState
  /** Localized copy of the `productSwitcher` namespace. */
  t: TranslateNS<'productSwitcher'>
  /** @param product - the segment the user pressed. */
  onSelect: (product: ComposerProduct) => void
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
 * @param props - the lifecycle state, the bridge commands, and localized copy.
 * @returns the window layer with the product bar and the native view's rectangle.
 */
export function ComposerSurface({ state, t, onSelect, show, setBounds, hide, retryComposer }: ComposerSurfaceProps) {
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
  useEffect(() => {
    const element = viewport.current
    /* v8 ignore next -- the layer always renders its viewport before effects run. */
    if (element === null) return
    const bounds = (): ComposerBounds => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    // Failures surface through the state main pushes, so a rejected command
    // never needs a second error path here.
    void commands.current.show(bounds()).catch(() => { /* state carries the failure */ })
    const track = (): void => {
      void commands.current.setBounds(bounds()).catch(() => { /* the view may be detaching */ })
    }
    const observer = new ResizeObserver(track)
    observer.observe(element)
    window.addEventListener('resize', track)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', track)
      void commands.current.hide().catch(() => { /* window teardown may remove the IPC receiver */ })
    }
  }, [])
  return createPortal(
    <div className={css.overlay}>
      <header className={css.header} data-window-drag>
        <div className={css.controls}>
          <span className={css.trafficLights} aria-hidden="true" />
          <ProductControl value="composer" label={t('group.label')}
            superharness={t('product.superharness')} composer={t('product.composer')} onChange={onSelect} />
        </div>
      </header>
      <div ref={viewport} className={css.viewport} role="region" aria-label={t('region.label')}>
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
    </div>,
    document.body,
  )
}

/** Full props of the `shell.overlay` occupant. */
export type ComposerViewProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product/state snapshot, the compose/attach commands, and localized copy.
 * @returns the Composer surface while Composer is selected, else null (the shell stays as-is).
 */
export function ComposerView({ useSwitcher, select, show, setBounds, hide, retry, t }: ComposerViewProps) {
  const product = useSwitcher(current => current.product)
  const state = useSwitcher(current => current.state)
  if (product !== 'composer') return null
  const onSelect = (choice: ComposerProduct): void => { select(choice) }
  return <ComposerSurface state={state} t={t} onSelect={onSelect}
    show={bounds => show(bounds)} setBounds={bounds => setBounds(bounds)} hide={() => hide()} retryComposer={() => retry()} />
}
