/** Sandboxed native view that hosts the Nexus Composer renderer beside the Superharness application. */

import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { WebContentsView, session, shell, type Input, type IpcMainInvokeEvent, type Session, type View, type WebContents } from 'electron'
import { serveWebDocument } from './web-document.ts'
import type { ComposerInvokeResult } from './composer-sidecar.ts'
import type { ComposerBounds } from './composer-ipc.ts'

/** Origin of the Composer document; resolved only inside the Composer partition. */
export const COMPOSER_ORIGIN = 'dsh-app://composer'
/** Persistent partition: Composer keeps local storage (theme, layout) across launches. */
export const COMPOSER_PARTITION = 'persist:dsh-composer'

export { COMPOSER_IPC } from './composer-ipc.ts'

/** Development layout of a Composer checkout given by `DSH_DESKTOP_COMPOSER_DIR`. */
export interface ComposerResources {
  /** Built renderer (`dist`). */
  readonly dist: string
  /** Sidecar executable. */
  readonly binary: string
}

/**
 * Resolve the optional development Composer. Absent disables the surface; set but unusable fails startup.
 * @param directory - `DSH_DESKTOP_COMPOSER_DIR` value.
 * @returns Composer resources, or undefined when the surface is disabled.
 * @throws When the directory is set but does not hold a built renderer and sidecar binary.
 */
export function developmentComposerResources(directory: string | undefined): ComposerResources | undefined {
  if (directory === undefined || directory === '') return undefined
  if (!isAbsolute(directory)) throw new Error('dsh desktop: DSH_DESKTOP_COMPOSER_DIR must be an absolute path')
  const dist = join(directory, 'dist')
  const binaryName = process.platform === 'win32' ? 'nexus-composer.exe' : 'nexus-composer'
  const binary = [join(directory, 'src-tauri', 'target', 'debug', binaryName), join(directory, 'src-tauri', 'target', 'release', binaryName)]
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile())
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`dsh desktop: DSH_DESKTOP_COMPOSER_DIR has no built renderer at ${dist}; run pnpm build:renderer there`)
  }
  if (binary === undefined) {
    throw new Error(`dsh desktop: DSH_DESKTOP_COMPOSER_DIR has no sidecar binary; run cargo build in ${join(directory, 'src-tauri')}`)
  }
  return { dist, binary }
}

/**
 * Resolve the Composer a packaged build embeds under `resources/composer`. Releases whose target the lock leaves
 * unavailable ship no Composer, so absence disables the surface instead of failing startup.
 * @param resourcesPath - Packaged `process.resourcesPath`.
 * @returns Composer resources, or undefined when the build embeds none.
 */
export function packagedComposerResources(resourcesPath: string): ComposerResources | undefined {
  const root = join(resourcesPath, 'composer')
  const dist = join(root, 'dist')
  const binary = join(root, 'bin', process.platform === 'win32' ? 'nexus-composer.exe' : 'nexus-composer')
  const index = join(dist, 'index.html')
  const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()
  return isFile(binary) && isFile(index) ? { dist, binary } : undefined
}

/**
 * Serve the Composer document inside its own partition only.
 * @param request - `dsh-app:` request from the Composer session.
 * @param dist - Built Composer renderer.
 * @returns static asset response; any other host is not found.
 */
export function serveComposerRequest(request: Request, dist: string): Promise<Response> {
  if (new URL(request.url).hostname !== 'composer') return Promise.resolve(new Response(null, { status: 404 }))
  return serveWebDocument(request, dist)
}

type ComposerSender = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>

/**
 * Accept IPC only from the top frame of the live Composer view while it shows the Composer origin.
 * @param event - IPC event.
 * @param contents - Current Composer view contents.
 */
export function isComposerSender(event: ComposerSender, contents: WebContents | undefined): boolean {
  if (contents === undefined || event.sender !== contents) return false
  const frame = event.senderFrame
  if (frame === null || frame !== contents.mainFrame) return false
  return isComposerUrl(frame.url)
}

/**
 * Whether a URL belongs to the Composer document. Compares scheme and host because Node reports an
 * opaque origin for custom schemes.
 */
export function isComposerUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.host === 'composer' && url.username === '' && url.password === ''
  } catch (_invalidUrl) { return false }
}

/**
 * Validate the preload invoke payload before it reaches the bridge.
 * @returns the command and argument object, or undefined.
 */
export function composerInvokeRequest(command: unknown, args: unknown): { command: string; args: Record<string, unknown> } | undefined {
  if (typeof command !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(command)) return undefined
  if (args === undefined) return { command, args: {} }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { command, args: args as Record<string, unknown> }
}

type ComposerOwner = { contentView: Pick<View, 'addChildView' | 'removeChildView'> }
/** Window that contains the Composer view. */
export type ComposerViewOwner = ComposerOwner

export type { ComposerBounds } from './composer-ipc.ts'

const RENDERER_CRASH_LIMIT = 3
const RENDERER_CRASH_WINDOW_MS = 60_000

/** Shell copy the view needs when it fails on its own, in the user's language. */
export interface ComposerViewMessages {
  /** Short title of the crash-loop failure. */
  readonly title: string
  /** What the user can do about it. */
  readonly detail: string
}

/** Owns the Composer partition and its single native view. */
export class DesktopComposerView {
  #view: WebContentsView | undefined
  #owner: ComposerOwner | undefined
  #session: Session | undefined
  #bounds: ComposerBounds | undefined
  #visible = false
  #crashes: number[] = []
  /** Keyboard input reaching the Composer renderer, for shell accelerators while it has focus. */
  onInput: ((event: Electron.Event, input: Input) => void) | undefined
  /** Attachment or visibility changed without an IPC command (crash recovery, window close). */
  onVisibility: (() => void) | undefined

  /**
   * @param preload - Bundled sandboxed Composer preload.
   * @param dist - Built Composer renderer.
   * @param onFatal - Composer reported an unrecoverable startup error; the shell shows it in the Composer surface.
   * @param messages - Localized crash-loop copy, read at failure time so a language change applies.
   */
  constructor(private readonly preload: string, private readonly dist: string,
    private readonly onFatal: (error: { title: string; message: string }) => void,
    private readonly messages: () => ComposerViewMessages) {}

  /** Whether the view is attached and shown. */
  get visible(): boolean { return this.#visible && this.#view !== undefined }

  /** Window the view is attached to. */
  get owner(): ComposerOwner | undefined { return this.#owner }

  /**
   * Forget a closed owner without touching its destroyed content view; the next show attaches elsewhere.
   * @param owner - Window that closed.
   */
  release(owner: ComposerOwner): void {
    if (this.#owner !== owner) return
    this.#owner = undefined
    this.#visible = false
    this.#view?.setVisible(false)
    this.onVisibility?.()
  }

  /** Live view contents, for IPC sender checks. */
  get contents(): WebContents | undefined { return this.#view?.webContents }

  /** Configure the partition once: protocol, permissions. */
  private partition(): Session {
    if (this.#session !== undefined) return this.#session
    const composerSession = session.fromPartition(COMPOSER_PARTITION)
    composerSession.protocol.handle('dsh-app', request => serveComposerRequest(request, this.dist))
    composerSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    composerSession.setPermissionCheckHandler(() => false)
    this.#session = composerSession
    return composerSession
  }

  /**
   * Attach (creating once) and show the view.
   * @param owner - Application window.
   * @param bounds - Area the Composer surface occupies.
   */
  show(owner: ComposerOwner, bounds: ComposerBounds): void {
    if (this.#view === undefined || this.#view.webContents.isDestroyed()) this.#view = this.create()
    if (this.#owner !== owner) {
      this.#owner?.contentView.removeChildView(this.#view)
      owner.contentView.addChildView(this.#view)
      this.#owner = owner
    }
    this.#view.setBounds(bounds)
    this.#view.setVisible(true)
    this.#bounds = bounds
    this.#visible = true
    this.onVisibility?.()
  }

  /** Hide without discarding renderer state. */
  hide(): void {
    this.#visible = false
    this.#view?.setVisible(false)
    this.onVisibility?.()
  }

  /** Detach and destroy the view. */
  close(): void {
    this.#visible = false
    this.detach()
  }

  private detach(): void {
    const view = this.#view
    this.#view = undefined
    if (view === undefined) return
    this.#owner?.contentView.removeChildView(view)
    this.#owner = undefined
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /** @param error - Payload the Composer preload forwarded. */
  reportFatal(error: unknown): void {
    if (typeof error !== 'object' || error === null) return
    const { title, message } = error as Record<string, unknown>
    if (typeof title === 'string' && typeof message === 'string') this.onFatal({ title: title.slice(0, 200), message: message.slice(0, 4_000) })
  }

  /** Replace a crashed renderer in place while it is on screen; a crash loop leaves it detached until the next show. */
  private rendererGone(): void {
    const owner = this.#owner
    const bounds = this.#bounds
    const visible = this.#visible
    this.detach()
    const now = Date.now()
    this.#crashes = [...this.#crashes.filter(time => now - time < RENDERER_CRASH_WINDOW_MS), now]
    if (!visible || owner === undefined || bounds === undefined) return
    if (this.#crashes.length > RENDERER_CRASH_LIMIT) {
      this.#visible = false
      this.onVisibility?.()
      // Localized in the shell's own dictionaries; the view holds no copy of
      // its own, so this reads the current language at failure time.
      const { title, detail } = this.messages()
      this.onFatal({ title, message: detail })
      return
    }
    this.show(owner, bounds)
  }

  private create(): WebContentsView {
    const view = new WebContentsView({ webPreferences: {
      session: this.partition(), preload: this.preload, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true,
    } })
    view.webContents.setWindowOpenHandler(({ url }) => {
      openExternally(url)
      return { action: 'deny' }
    })
    const keepOnOrigin = (event: { preventDefault(): void }, url: string): void => {
      if (isComposerUrl(url)) return
      event.preventDefault()
      openExternally(url)
    }
    view.webContents.on('will-navigate', keepOnOrigin)
    view.webContents.on('will-redirect', (event) => { event.preventDefault() })
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    view.webContents.on('render-process-gone', () => { if (this.#view === view) this.rendererGone() })
    view.webContents.on('before-input-event', (event, input) => { this.onInput?.(event, input) })
    view.setVisible(false)
    void view.webContents.loadURL(`${COMPOSER_ORIGIN}/`).catch(() => {
      // A failed load leaves the view blank; the next show recreates it after a renderer crash.
    })
    return view
  }
}

function openExternally(url: string): void {
  try {
    const destination = new URL(url)
    if ((destination.protocol === 'https:' || destination.protocol === 'http:') && !destination.username && !destination.password) {
      void shell.openExternal(url).catch(() => { /* OS browser launch failure is not actionable here. */ })
    }
  } catch (_invalidUrl) { /* Ignore. */ }
}

/** Result for a rejected or unavailable invoke, in the renderer envelope. */
export function composerBridgeError(code: string, retryable = false): ComposerInvokeResult {
  return { bridgeError: { code, retryable } }
}
