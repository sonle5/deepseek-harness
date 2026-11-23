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
} as const

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
}
