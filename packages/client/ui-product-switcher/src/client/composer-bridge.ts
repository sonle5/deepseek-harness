/**
 * Read-only mirror of the `window.dshComposer` contract that the Desktop
 * preload installs on the main application document. Main owns the native
 * Composer view, the sidecar, and the menu accelerators; this document owns
 * which product is selected and the rectangle the view covers.
 *
 * The contract lives with the Desktop implementation
 * (`apps/desktop/src/composer-ipc.ts`); this package restates only the surface
 * it consumes, so a plain `dsh web` build (no `dshComposer`) and a Desktop
 * build without a usable Composer (`available: false`) stay distinguishable.
 */

/** The products this document can show. */
export type ComposerProduct = 'superharness' | 'composer'

/** A product switch requested by main: an explicit product, or a flip. */
export type ComposerChoice = ComposerProduct | 'toggle'

/** Rectangle the native Composer view covers, in CSS px of window content coordinates. */
export interface ComposerBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Surface lifecycle reported by main. */
export type ComposerStatus = 'idle' | 'starting' | 'ready' | 'restarting' | 'failed'

/** Product tab Composer's own views are grouped under. */
export type ComposerApp = 'codex' | 'vscode' | 'claude'

/** One row of Composer's navigation, as the embedded renderer publishes it. */
export interface ComposerNavigationView {
  /** Composer's `currentView` value. */
  readonly id: string
  /** Row label, already localized by Composer. */
  readonly label: string
  /** Product tab this view belongs to, when it is tab-specific. */
  readonly app?: ComposerApp
}

/** Navigation Composer published so this shell can mirror it in the sidebar. */
export interface ComposerNavigationState {
  /** Views the sidebar may show, in order. */
  readonly views: readonly ComposerNavigationView[]
  /** The view currently shown. */
  readonly current: string
  /** The product tab currently selected. */
  readonly app: ComposerApp
}

/**
 * Which process routes Composer traffic: this application (`owner`), a
 * development profile (`isolated`), or a standalone Composer (`external`).
 */
export type ComposerOwnership = 'owner' | 'isolated' | 'external'

/** Complete switcher state; main sends a full snapshot on every change. */
export interface ComposerSwitcherState {
  /** This build embeds a usable Composer and the OS meets the floor. */
  readonly available: boolean
  /** Surface lifecycle. */
  readonly status: ComposerStatus
  /** Routing owner; `external` means a standalone Composer runs separately. */
  readonly ownership?: ComposerOwnership
  /** Composer version reported by the sidecar. */
  readonly version?: string
  /** Restart attempt while restarting. */
  readonly attempt?: number
  /** Human-readable error while restarting or failed. */
  readonly error?: string
  /** Failed: the pinned and running Composer disagree; retry cannot help. */
  readonly incompatible?: boolean
  /** Failed: routing was restored and Codex Desktop must be restarted. */
  readonly codexRestartRequired?: boolean
  /** The native Composer view is attached and visible. */
  readonly visible: boolean
  /** Composer's own navigation; absent until it publishes and after a reload. */
  readonly navigation?: ComposerNavigationState
}

/** Bridge main installs on the main application document. */
export interface DshComposerBridge {
  readonly protocolVersion: 1
  /** @returns the current switcher state. */
  state(): Promise<ComposerSwitcherState>
  /** @param listener - receives the full state on every change. @returns unsubscribe. */
  subscribe(listener: (state: ComposerSwitcherState) => void): () => void
  /** Show Composer over `bounds`, starting the sidecar when idle. @param bounds - view rectangle. */
  show(bounds: ComposerBounds): Promise<void>
  /** Move or resize the attached view. @param bounds - view rectangle. */
  setBounds(bounds: ComposerBounds): Promise<void>
  /** Detach the view; the sidecar keeps running. */
  hide(): Promise<void>
  /** Retry after a failure. */
  retry(): Promise<void>
  /** Main asks this document to switch product. @param listener - requested product. @returns unsubscribe. */
  onSelect(listener: (product: ComposerChoice) => void): () => void
  /** Ask the embedded Composer to show one of the views it published. @param request - view to show. */
  navigate(request: { readonly view: string; readonly app?: ComposerApp }): Promise<void>
}

/** The global the preload installs; absent in a plain Web build. */
export interface ComposerGlobal {
  readonly dshComposer?: unknown
}

/**
 * Read the bridge from a global object.
 * @param source - the global scope, normally `globalThis`.
 * @returns the bridge when this build speaks its protocol, else undefined.
 */
export function readComposerBridge(source: ComposerGlobal): DshComposerBridge | undefined {
  const bridge = source.dshComposer as Partial<DshComposerBridge> | undefined
  return bridge?.protocolVersion === 1 ? bridge as DshComposerBridge : undefined
}
