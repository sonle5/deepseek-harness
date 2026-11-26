/** IPC contract between the Composer preload and the main process; safe to bundle into a sandboxed preload. */

export const COMPOSER_IPC = {
  /** renderer → main: `(command, args)` → renderer invoke envelope. */
  invoke: 'dsh-composer:invoke',
  /** renderer → main: unrecoverable startup error `{ title, message }`. */
  fatal: 'dsh-composer:fatal',
  /** main → renderer: backend event `{ event, payload }`. */
  event: 'dsh-composer:event',
} as const

/** Host protocol the Composer renderer expects (`src/lib/transport/host.ts` in Composer). */
export const COMPOSER_HOST_PROTOCOL = 1

/** Superharness | Composer switcher between main and the application document (`window.dshComposer`). */
export const COMPOSER_SWITCHER_IPC = {
  /** app → main: current switcher state. */
  state: 'dsh-composer-switcher:state',
  /** app → main: `(bounds)` attach and show the Composer view, starting the sidecar when idle. */
  show: 'dsh-composer-switcher:show',
  /** app → main: `(bounds)` move the visible Composer view. */
  bounds: 'dsh-composer-switcher:bounds',
  /** app → main: hide the Composer view; the sidecar keeps running. */
  hide: 'dsh-composer-switcher:hide',
  /** app → main: retry a Composer that gave up. */
  retry: 'dsh-composer-switcher:retry',
  /** main → app: full switcher state on every change. */
  changed: 'dsh-composer-switcher:changed',
  /** main → app: menu or accelerator product selection (`'superharness' | 'composer' | 'toggle'`). */
  select: 'dsh-composer-switcher:select',
  /** app → main: `(request)` ask Composer to show one of its views. */
  navigate: 'dsh-composer-switcher:navigate',
} as const

/** Product tabs Composer's own views are grouped under. */
export type ComposerApp = 'codex' | 'vscode' | 'claude'

/** One row of Composer's navigation, as the embedded renderer publishes it. */
export interface ComposerNavigationView {
  /** `currentView` value in Composer's `App.tsx`. */
  readonly id: string
  /** Row label, already localized by Composer; the host holds no copy of its dictionaries. */
  readonly label: string
  /** Product tab the view belongs to, when it is tab-specific. */
  readonly app?: ComposerApp
}

/** Navigation Composer publishes so the embedding host can mirror it in the sidebar. */
export interface ComposerNavigationState {
  /** Views the sidebar may show, in order. */
  readonly views: readonly ComposerNavigationView[]
  /** The view currently shown. */
  readonly current: string
  /** The product tab currently selected. */
  readonly app: ComposerApp
}

/** A host request for Composer to show a view. */
export interface ComposerNavigateRequest {
  /** View to show. */
  readonly view: string
  /** Product tab to select first, when the view is tab-specific. */
  readonly app?: ComposerApp
}

/** Area the Composer view covers, in CSS pixels of the window content. */
export interface ComposerBounds { x: number; y: number; width: number; height: number }

/** Product the switcher shows. */
export type ComposerProduct = 'superharness' | 'composer'

/** Switcher state the application document renders. */
export interface ComposerSwitcherState {
  /** This build embeds a usable Composer and the OS meets the floor (macOS 14+). */
  readonly available: boolean
  readonly status: 'idle' | 'starting' | 'ready' | 'restarting' | 'failed'
  readonly ownership?: 'owner' | 'isolated' | 'external'
  readonly version?: string
  readonly attempt?: number
  readonly error?: string
  /** failed: the running Composer speaks another protocol; retry will not help. */
  readonly incompatible?: boolean
  readonly codexRestartRequired?: boolean
  /** The native Composer view is attached and visible. */
  readonly visible: boolean
  /**
   * Composer's own navigation, mirrored so the sidebar can offer its views
   * while Composer is the selected product. Absent until the renderer publishes
   * and after a reload, when no row would address a live view.
   */
  readonly navigation?: ComposerNavigationState
}
