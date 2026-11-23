/**
 * Superharness | Composer product switcher.
 *
 * The Desktop application document exposes `window.dshComposer` (protocol 1)
 * on top of the shell. This plugin activates only when that bridge exists and
 * this build embeds a usable Composer, then registers two sidebar controls and
 * the Composer surface. Main owns the native view, the sidecar, and the menu
 * accelerators; this document owns which product is selected and the rectangle
 * the view covers.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ComposerBounds, ComposerChoice, ComposerGlobal, ComposerSwitcherState } from './composer-bridge.ts'
import { readComposerBridge } from './composer-bridge.ts'
import { ComposerView } from './ComposerView.tsx'
import type { ProductSwitcherInjected, ProductSwitcherSnapshot } from './contract.ts'
import { NS } from './contract.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'
import { LeadingProductSwitcher, ProductSwitcher } from './ProductSwitcher.tsx'

/** Slot service plus the locale dictionaries this plugin registers. */
export const inject = ['slots', 'locale']

/**
 * Register the switcher when this document can drive a Composer.
 * @param ctx - client plugin context carrying slots and locale.
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

  const store = createSnapshotStore<ProductSwitcherSnapshot>({ product: 'superharness', state: initial })
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
    store.set({ ...current, product: next })
  }
  // Menu items, accelerators, the tray and the caption menu all arrive here.
  ctx.effect(() => bridge.onSelect(select), 'product switcher: main selections')

  const show = (bounds: ComposerBounds): Promise<void> => bridge.show(bounds)
  const setBounds = (bounds: ComposerBounds): Promise<void> => bridge.setBounds(bounds)
  const hide = (): Promise<void> => bridge.hide()
  const retryComposer = (): Promise<void> => bridge.retry()
  const injected = (): ProductSwitcherInjected => ({
    hooks: { switcher: store },
    select: (choice: ComposerChoice): void => { select(choice) },
    show: (bounds: ComposerBounds): Promise<void> => show(bounds),
    setBounds: (bounds: ComposerBounds): Promise<void> => setBounds(bounds),
    hide: (): Promise<void> => hide(),
    retry: (): Promise<void> => retryComposer(),
  })

  ctx.slots.inject('sidebar.product', () => ctx.slots.register({
    name: 'sidebar.product', locale: NS, inject: injected,
  }, ProductSwitcher))
  ctx.slots.inject('sidebar.leading.product', () => ctx.slots.register({
    name: 'sidebar.leading.product', locale: NS, inject: injected,
  }, LeadingProductSwitcher))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'product-switcher.composer', locale: NS, inject: injected,
  }, ComposerView))
}
