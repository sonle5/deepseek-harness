/**
 * Snapshot and injected-face contract shared by the switcher controls and the
 * Composer view. Kept in its own module so the components never import the
 * plugin entry that registers them.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ComposerApp, ComposerBounds, ComposerChoice, ComposerProduct, ComposerSwitcherState,
} from './composer-bridge.ts'

/** Locale namespace of the switcher copy. */
export const NS = 'productSwitcher'

/** Selected product plus the latest main-process state. */
export interface ProductSwitcherSnapshot {
  /** Product this document shows. */
  readonly product: ComposerProduct
  /** Latest state main pushed. */
  readonly state: ComposerSwitcherState
}

/** Injected business face shared by every switcher surface. */
export interface ProductSwitcherInjected {
  /** Live product and state snapshot. */
  hooks: { switcher: HostObservable<ProductSwitcherSnapshot> }
  /**
   * Switch product; `toggle` flips the current one.
   * @param choice - product main or the user asked for.
   */
  select(this: void, choice: ComposerChoice): void
  /**
   * Attach the native Composer view over `bounds`, starting the sidecar when idle.
   * @param bounds - view rectangle in CSS px of the window content.
   */
  show(this: void, bounds: ComposerBounds): Promise<void>
  /**
   * Move or resize the attached view.
   * @param bounds - view rectangle in CSS px of the window content.
   */
  setBounds(this: void, bounds: ComposerBounds): Promise<void>
  /** Detach the view; the sidecar keeps running. */
  hide(this: void): Promise<void>
  /** Retry a Composer that gave up. */
  retry(this: void): Promise<void>
  /**
   * Show one of Composer's own views, addressed by the id it published.
   * @param view - view id from the current navigation state.
   * @param app - product tab the view belongs to, when it is tab-specific.
   */
  navigate(this: void, view: string, app?: ComposerApp): Promise<void>
}
