/** Superharness | Composer switcher: the application document's view of the native Composer surface. */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type Input } from 'electron'
import { COMPOSER_SWITCHER_IPC, type ComposerProduct, type ComposerSwitcherState } from './composer-ipc.ts'
import type { ComposerSurfaceStatus } from './composer-surface.ts'
import { ComposerIncompatibleError } from './composer-sidecar.ts'
import type { ComposerBounds, DesktopComposerView } from './composer-view.ts'
import { platformBounds } from './platform-view.ts'

/** Oldest macOS (Darwin major 23 = 14 Sonoma) whose WebContents can host the Composer renderer. */
export const COMPOSER_MINIMUM_DARWIN_MAJOR = 23

/** The Composer surface as the switcher needs it. */
export type ComposerSwitcherSurface = {
  /** The native view; the switcher attaches it to the product window. */
  readonly view: Pick<DesktopComposerView, 'show' | 'hide' | 'visible' | 'owner'>
  readonly status: ComposerSurfaceStatus
  /** Facts from the sidecar's ready message; undefined while none serves. */
  readonly ready: { readonly version: string; readonly ownership: string } | undefined
  /** Start the sidecar when idle; never throws into IPC (failures surface through status). */
  start(): Promise<unknown>
  retry(): Promise<unknown>
}

/** A product window the switcher may attach the Composer view to. */
export type ComposerSwitcherOwner = Pick<BrowserWindow, 'isDestroyed' | 'webContents' | 'contentView'>

export interface ComposerSwitcherOptions {
  /** This build embeds a usable Composer; combined with the OS floor for `available`. */
  readonly configured: boolean
  /** `os.release()`; consulted only on macOS. */
  readonly osRelease: string
  /** `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Current product window; undefined while none exists. */
  readonly window: () => ComposerSwitcherOwner | undefined
  /** Composer surface; undefined when the build embeds none. */
  readonly surface: () => ComposerSwitcherSurface | undefined
  /** Shell-owned input blocking (mandatory update or overlay) for the owner. */
  readonly blocked: (owner: ComposerSwitcherOwner) => boolean
  /** Move shell overlays above views attached after them. */
  readonly raiseOverlays?: (owner: ComposerSwitcherOwner) => void
}

/**
 * Whether the running OS can host the Composer surface. macOS before 14 lacks APIs the renderer relies on.
 * @param release - `os.release()`.
 * @param platform - `process.platform`.
 */
export function composerOsCompatible(release: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return true
  const major = Number.parseInt(release.split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= COMPOSER_MINIMUM_DARWIN_MAJOR
}

/** Map the surface status and ready facts onto the document contract. */
export function composerSwitcherState(surface: ComposerSwitcherSurface | undefined, available: boolean,
  visible: boolean): ComposerSwitcherState {
  const status = surface?.status ?? { state: 'idle' as const }
  const ready = surface?.ready
  const ownership = ready?.ownership === 'owner' || ready?.ownership === 'isolated' || ready?.ownership === 'external'
    ? ready.ownership : undefined
  const base: ComposerSwitcherState = {
    available,
    status: status.state,
    ...(ownership === undefined ? {} : { ownership }),
    ...(ready === undefined ? {} : { version: ready.version }),
    visible,
  }
  if (status.state === 'restarting') {
    return { ...base, attempt: status.attempt, error: status.error.message }
  }
  if (status.state === 'failed') {
    return {
      ...base, error: status.error.message,
      ...(status.error instanceof ComposerIncompatibleError ? { incompatible: true } : {}),
      ...(status.codexRestartRequired === true ? { codexRestartRequired: true } : {}),
    }
  }
  return base
}

/**
 * Wire the switcher IPC, the accelerators reaching the Composer view, and state pushes.
 * @param options - window, surface, blocking and overlay access.
 * @returns teardown and the operations main.ts calls on lifecycle changes.
 */
export function installComposerSwitcher(options: ComposerSwitcherOptions): {
  /** This build and OS can host Composer; menu entries and accelerators exist only then. */
  readonly available: boolean
  /**
   * Start the embedded sidecar at launch instead of on the first Composer view, so its proxy binds the
   * clients' configured port before any traffic arrives. Ownership is decided once at startup and never
   * retried, so a sidecar started later cannot take over from a standalone Composer that already quit.
   * A no-op without an available surface; failures surface through the switcher state.
   */
  start(): void
  /** Push the current state to the application document. */
  publish(): void
  /** Re-attach after the window was recreated, or hide while an overlay blocks input. */
  sync(): void
  /** Ask the application document to switch product. */
  select(product: ComposerProduct | 'toggle'): void
  /** Menu accelerator forwarding for the Composer view's webContents. */
  forwardInput(event: Electron.Event, input: Input): void
  dispose(): void
} {
  const platform = options.platform ?? process.platform
  // The renderer owns the layout and the active product; remembering both lets a recreated window
  // reattach the view without a round trip.
  let lastBounds: ComposerBounds | undefined
  let requested = false
  const available = options.configured && composerOsCompatible(options.osRelease, platform)
  const assertOwner = (event: IpcMainInvokeEvent): ComposerSwitcherOwner => {
    const owner = options.window()
    if (owner === undefined || owner.isDestroyed() || event.sender !== owner.webContents
      || event.senderFrame === null || event.senderFrame !== owner.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected Composer switcher command')
    return owner
  }
  const current = (): ComposerSwitcherState => composerSwitcherState(options.surface(), available,
    options.surface()?.view.visible === true)
  const publish = (): void => {
    const owner = options.window()
    if (owner === undefined || owner.isDestroyed()) return
    owner.webContents.send(COMPOSER_SWITCHER_IPC.changed, current())
  }
  const validBounds = (value: unknown): ComposerBounds => {
    try {
      return platformBounds(value)
    } catch {
      throw new Error('Invalid Composer bounds')
    }
  }
  const show = (bounds: unknown): void => {
    const owner = options.window()
    const surface = options.surface()
    if (owner === undefined || owner.isDestroyed() || surface === undefined) return
    if (!available) throw new Error('Composer is not available')
    const area = validBounds(bounds)
    lastBounds = area
    // Blocking overlays own the surface; the renderer retries once they release.
    if (options.blocked(owner)) { publish(); return }
    requested = true
    // Failed surfaces wait for `retry`, so a show never silently re-enters a restart loop.
    if (surface.status.state === 'idle') void surface.start().catch(() => { /* status carries it */ })
    // A failed surface has no sidecar behind it; the client renders its own error and retry action.
    if (surface.status.state !== 'failed') surface.view.show(owner, area)
    options.raiseOverlays?.(owner)
    publish()
  }
  const setBounds = (bounds: unknown): void => {
    const owner = options.window()
    const surface = options.surface()
    const area = validBounds(bounds)
    lastBounds = area
    if (owner === undefined || surface === undefined || !surface.view.visible) return
    surface.view.show(owner, area)
    options.raiseOverlays?.(owner)
  }
  const hide = (): void => {
    requested = false
    options.surface()?.view.hide()
    publish()
  }
  const retry = async (): Promise<void> => {
    const surface = options.surface()
    if (surface === undefined) return
    await surface.retry().catch(() => { /* state carries the failure */ })
    // A retry that succeeds attaches at the last rectangle the renderer asked for.
    const owner = options.window()
    if (requested && lastBounds !== undefined && owner !== undefined && !owner.isDestroyed()
      && surface.status.state !== 'failed' && !options.blocked(owner)) surface.view.show(owner, lastBounds)
    publish()
  }
  const select = (product: ComposerProduct | 'toggle'): void => {
    const owner = options.window()
    if (!available || owner === undefined || owner.isDestroyed()) return
    owner.webContents.send(COMPOSER_SWITCHER_IPC.select, product)
  }
  ipcMain.handle(COMPOSER_SWITCHER_IPC.state, (event) => { assertOwner(event); return current() })
  ipcMain.handle(COMPOSER_SWITCHER_IPC.show, (event, bounds: unknown) => { assertOwner(event); show(bounds) })
  ipcMain.handle(COMPOSER_SWITCHER_IPC.bounds, (event, bounds: unknown) => { assertOwner(event); setBounds(bounds) })
  ipcMain.handle(COMPOSER_SWITCHER_IPC.hide, (event) => { assertOwner(event); hide() })
  ipcMain.handle(COMPOSER_SWITCHER_IPC.retry, (event) => { assertOwner(event); return retry() })
  return {
    available,
    start() {
      const surface = options.surface()
      // Only an idle surface starts: a failed one waits for `retry`, exactly as `show` decides, so launch
      // never re-enters a restart loop the user has not asked to resume.
      if (!available || surface === undefined || surface.status.state !== 'idle') return
      void surface.start().catch(() => { /* status carries the failure to the client */ })
    },
    publish,
    sync() {
      const owner = options.window()
      const surface = options.surface()
      if (owner === undefined || owner.isDestroyed()) return
      if (surface === undefined) { publish(); return }
      // A blocking overlay suspends the view without forgetting the client's selection.
      if (requested && lastBounds !== undefined && !options.blocked(owner) && surface.status.state !== 'failed') {
        if (!surface.view.visible || surface.view.owner !== owner) surface.view.show(owner, lastBounds)
      } else if (surface.view.visible) surface.view.hide()
      options.raiseOverlays?.(owner)
      publish()
    },
    select,
    forwardInput(event, input) {
      if (!available) return
      const modifiers = (['control', 'alt', 'shift', 'meta'] as const).filter(key => input[key])
      if (input.type !== 'keyDown' || modifiers.length !== 1 || (modifiers[0] !== 'meta' && modifiers[0] !== 'control')) return
      if (input.code !== 'Digit1' && input.code !== 'Digit2') return
      // Only the platform's own switcher modifier, matching the menu accelerators.
      if (platform === 'darwin' ? modifiers[0] !== 'meta' : modifiers[0] !== 'control') return
      event.preventDefault()
      select(input.code === 'Digit1' ? 'superharness' : 'composer')
    },
    dispose() {
      for (const channel of [COMPOSER_SWITCHER_IPC.state, COMPOSER_SWITCHER_IPC.show,
        COMPOSER_SWITCHER_IPC.bounds, COMPOSER_SWITCHER_IPC.hide, COMPOSER_SWITCHER_IPC.retry]) {
        ipcMain.removeHandler(channel)
      }
    },
  }
}

export { COMPOSER_SWITCHER_IPC }
export type { ComposerSwitcherState }
