/**
 * Superharness | Composer product switcher.
 *
 * The Desktop application document exposes `window.dshComposer` (protocol 1)
 * on top of the shell. This plugin activates only when that bridge exists and
 * this build embeds a usable Composer, then registers two sidebar controls and
 * the Composer main panel. Main owns the native view, the sidecar, and the menu
 * accelerators; this document owns which product is selected and the rectangle
 * the view covers.
 *
 * Composer is a `main` panel, not a window-covering layer: the frame swaps the
 * center column and keeps the sidebar, the drag rows and the window chrome
 * mounted, so the two products share one shell. The selected product and the
 * selected main panel are therefore the same fact, kept in step in both
 * directions — switching product selects the panel, and navigating to another
 * panel leaves Composer.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ComposerApp, ComposerBounds, ComposerChoice, ComposerGlobal, ComposerSwitcherState } from './composer-bridge.ts'
import { readComposerBridge } from './composer-bridge.ts'
import { ComposerNavigation } from './ComposerNavigation.tsx'
import { ComposerView } from './ComposerView.tsx'
import type { ProductSwitcherInjected, ProductSwitcherSnapshot } from './contract.ts'
import { NS } from './contract.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'
import { LeadingProductSwitcher, ProductSwitcher } from './ProductSwitcher.tsx'
import { readStoredProduct, writeStoredProduct } from './product-storage.ts'

/** The main-panel key the Composer surface occupies. */
export const PANEL_ID = 'composer' as MainPanelId

/** Slot service, locale dictionaries, and the layout panel selection. */
export const inject = ['slots', 'locale', 'layout']

/**
 * Register the switcher when this document can drive a Composer.
 * @param ctx - client plugin context carrying slots, locale and layout.
 * @returns resolves after the bridge state is read and the surfaces are registered.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const bridge = readComposerBridge(globalThis as typeof globalThis & ComposerGlobal)
  // A plain `dsh web` document never gets the bridge; no switcher belongs there.
  if (bridge === undefined) return
  let initial: ComposerSwitcherState
  try {
    initial = await bridge.state()
  } catch (error) {
    // Unloading while the read was in flight is not a failure; log the real
    // one only when this fiber is still live.
    if (ctx.fiber.uid === null) return
    ctx.logger.error('product switcher: reading the Composer state failed', error)
    return
  }
  // The fiber may have been disposed while the state read was pending.
  if (ctx.fiber.uid === null) return
  // A build without an embedded, OS-compatible Composer keeps the shell as-is:
  // no control, no surface, nothing model-facing.
  if (!initial.available) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, de, es, fr, ru, pt }), 'product switcher: dictionaries')

  // Main keeps the Composer view attached across a reload and reattaches it to a
  // recreated window. A visible view therefore names the product even when the
  // stored choice is missing or stale, so the switcher never names Superharness
  // over a painted Composer.
  const product = initial.visible ? 'composer' : readStoredProduct()
  if (initial.visible) writeStoredProduct(product)
  // Main can still hold a Composer request with the view hidden, behind a blocking
  // overlay or a surface that is not serving, and would reattach the view once that
  // clears. A document that starts on Superharness withdraws that request.
  else if (product === 'superharness') {
    void bridge.hide().catch(() => { /* window teardown may remove the IPC receiver */ })
  }
  const store = createSnapshotStore<ProductSwitcherSnapshot>({ product, state: initial })
  ctx.effect(() => bridge.subscribe((state) => {
    // The snapshot is readonly; main's push replaces its state half wholesale.
    store.set({ product: store.getSnapshot().product, state })
  }), 'product switcher: state pushes')

  const select = (choice: ComposerChoice): void => {
    // A repeat selection is a no-op: main resends the accelerator that produced it.
    const next = choice === 'toggle'
      ? store.getSnapshot().product === 'composer' ? 'superharness' : 'composer'
      : choice
    const current = store.getSnapshot()
    if (next === current.product) return
    // Remember the choice before publishing it, so a launch that crashes while
    // the Composer surface starts still comes back to the product the user chose.
    writeStoredProduct(next)
    store.set({ ...current, product: next })
  }
  // Menu items, accelerators, the tray and the caption menu all arrive here.
  ctx.effect(() => bridge.onSelect(select), 'product switcher: main selections')

  // The selected product and the selected main panel are one fact. Selecting
  // Composer shows its panel; leaving the panel (any sidebar entry or the
  // conversation itself) returns to Superharness, so the switcher can never
  // name a product the frame is not showing.
  const panelRegistered = (): boolean =>
    ctx.slots.entries('main').some(entry => entry.options.key === PANEL_ID)
  const syncPanel = (): void => {
    // Nothing to select until the panel is registered; the registration below
    // calls this again once it is.
    if (!panelRegistered()) return
    const onComposer = ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
    const product = store.getSnapshot().product
    if (product === 'composer' && !onComposer) ctx.layout.selectPanel(PANEL_ID)
    else if (product !== 'composer' && onComposer) ctx.layout.selectPanel(null)
  }
  ctx.effect(() => {
    syncPanel()
    const disposeStore = store.subscribe(syncPanel)
    const disposePanel = ctx.layout.panelInfo.subscribe(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID
        && store.getSnapshot().product === 'composer') select('superharness')
    })
    return () => {
      disposeStore()
      disposePanel()
    }
  }, 'product switcher: panel selection')

  const show = (bounds: ComposerBounds): Promise<void> => bridge.show(bounds)
  const setBounds = (bounds: ComposerBounds): Promise<void> => bridge.setBounds(bounds)
  const hide = (): Promise<void> => bridge.hide()
  const retryComposer = (): Promise<void> => bridge.retry()
  const navigateComposer = (view: string, app?: ComposerApp): Promise<void> => bridge.navigate(
    app === undefined ? { view } : { view, app },
  )
  const injected = (): ProductSwitcherInjected => ({
    hooks: { switcher: store },
    select: (choice: ComposerChoice): void => { select(choice) },
    show: (bounds: ComposerBounds): Promise<void> => show(bounds),
    setBounds: (bounds: ComposerBounds): Promise<void> => setBounds(bounds),
    hide: (): Promise<void> => hide(),
    retry: (): Promise<void> => retryComposer(),
    navigate: (view: string, app?: ComposerApp): Promise<void> => navigateComposer(view, app),
  })

  ctx.slots.inject('sidebar.product', () => ctx.slots.register({
    name: 'sidebar.product', locale: NS, inject: injected,
  }, ProductSwitcher))
  ctx.slots.inject('sidebar.leading.product', () => ctx.slots.register({
    name: 'sidebar.leading.product', locale: NS, inject: injected,
  }, LeadingProductSwitcher))
  ctx.slots.inject('sidebar.navigation', () => ctx.slots.register({
    name: 'sidebar.navigation', id: 'composer', locale: NS, inject: injected,
  }, ComposerNavigation))
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main', key: PANEL_ID, locale: NS, inject: injected,
    }, ComposerView)
    // The panel exists only once the frame has declared the seat. A product
    // chosen before that (a main-process accelerator at launch) is applied now.
    syncPanel()
  })
}
