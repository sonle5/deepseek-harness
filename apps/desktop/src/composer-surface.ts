/** Wires the Composer sidecar, its view and the preload IPC into the application lifetime. */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ComposerSidecar, type ComposerReady, type ComposerSidecarOptions } from './composer-sidecar.ts'
import { COMPOSER_IPC } from './composer-ipc.ts'
import {
  DesktopComposerView, composerBridgeError, composerInvokeRequest, isComposerSender, type ComposerResources,
} from './composer-view.ts'

/** Delays before each restart of a sidecar that failed after ready; one entry per attempt. */
export const COMPOSER_RESTART_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000]
/** A sidecar that stayed up this long earns a fresh restart budget. */
export const COMPOSER_HEALTHY_MS = 60_000

/** Surface state the shell renders in place of, or around, the Composer view. */
export type ComposerSurfaceStatus =
  | { readonly state: 'idle' | 'starting' | 'ready' }
  | { readonly state: 'restarting'; readonly attempt: number; readonly error: Error }
  /** Restarts are exhausted; client routing was restored (or the restore failed, in `restoreError`). */
  | { readonly state: 'failed'; readonly error: Error; readonly restoreError?: Error; readonly codexRestartRequired?: boolean }

export interface ComposerSurfaceOptions {
  readonly resources: ComposerResources
  /** Bundled `preload-composer.js`. */
  readonly preload: string
  /** Isolated storage root; the sidecar refuses to run against the shared profile until it holds the owner lock. */
  readonly home: string
  /** Process environment for the sidecar, for example the login-shell environment Hosts use. */
  readonly environment?: () => Promise<NodeJS.ProcessEnv>
  /** Whether the user allowed product usage telemetry; the sidecar sends none otherwise. */
  readonly telemetryConsent?: boolean
  /** Composer-scoped failure: never a reason to stop Superharness. */
  readonly onError: (error: Error) => void
  /** Status changes for the switcher and the Composer surface. */
  readonly onStatus?: (status: ComposerSurfaceStatus) => void
  /** Bridge origin changed (undefined while no sidecar serves); browser guests must not reach it. */
  readonly onBridgeUrl?: (url: string | undefined) => void
  /** Tests replace the sidecar and the clock. */
  readonly createSidecar?: (options: ComposerSidecarOptions) => Pick<ComposerSidecar, 'start' | 'invoke' | 'stop' | 'restore'>
  readonly delay?: (ms: number) => Promise<void>
  readonly now?: () => number
  /** Tests skip Electron IPC and the native view. */
  readonly ipc?: boolean
}

type Sidecar = Pick<ComposerSidecar, 'start' | 'invoke' | 'stop' | 'restore'>

/** Composer inside Superharness: one supervised sidecar, one view. */
export class DesktopComposerSurface {
  readonly view: DesktopComposerView
  #sidecar: Sidecar | undefined
  #starting: Promise<ComposerReady> | undefined
  #status: ComposerSurfaceStatus = { state: 'idle' }
  #attempt = 0
  #readyAt: number | undefined
  #closed = false
  #recovery: Promise<void> | undefined

  constructor(private readonly options: ComposerSurfaceOptions) {
    this.view = new DesktopComposerView(options.preload, options.resources.dist, ({ title, message }) => {
      options.onError(new Error(`${title}: ${message}`))
    })
    if (options.ipc === false) return
    ipcMain.handle(COMPOSER_IPC.invoke, (event, command: unknown, args: unknown) => this.invoke(event, command, args))
    ipcMain.handle(COMPOSER_IPC.fatal, (event, error: unknown) => {
      if (isComposerSender(event, this.view.contents)) this.view.reportFatal(error)
    })
  }

  get status(): ComposerSurfaceStatus { return this.#status }

  /** Start the sidecar once; failures are reported, not thrown into application startup. */
  start(): Promise<ComposerReady> {
    if (this.#closed) return Promise.reject(new Error('nexus composer surface is closed'))
    if (this.#status.state === 'failed') return Promise.reject(this.#status.error)
    return this.#starting ??= this.spawn()
  }

  /** Try again after a give-up, for example from the Composer surface's retry action. */
  retry(): Promise<ComposerReady> {
    if (this.#status.state !== 'failed') return this.start()
    this.#attempt = 0
    this.#starting = undefined
    this.setStatus({ state: 'idle' })
    return this.start()
  }

  private async spawn(): Promise<ComposerReady> {
    this.setStatus(this.#attempt === 0 ? { state: 'starting' } : this.#status)
    const sidecar = await this.createSidecar()
    this.#sidecar = sidecar
    try {
      const ready = await sidecar.start()
      if (this.#closed) throw new Error('nexus composer surface is closed')
      this.#readyAt = this.now()
      this.options.onBridgeUrl?.(ready.url)
      this.setStatus({ state: 'ready' })
      return ready
    } catch (error) {
      const failure = asError(error)
      if (!this.#closed && this.#sidecar === sidecar) {
        this.options.onError(failure)
        this.recover(sidecar, failure)
      }
      throw failure
    }
  }

  private async createSidecar(): Promise<Sidecar> {
    const environment = { ...await this.options.environment?.() ?? process.env }
    if (this.options.telemetryConsent === true) environment.NEXUS_COMPOSER_TELEMETRY_CONSENT = 'granted'
    else delete environment.NEXUS_COMPOSER_TELEMETRY_CONSENT
    let instance: Sidecar | undefined = undefined
    const options: ComposerSidecarOptions = {
      binary: this.options.resources.binary,
      home: this.options.home,
      environment,
      onFailure: (error) => {
        if (this.#closed || instance === undefined || this.#sidecar !== instance) return
        this.options.onError(error)
        this.recover(instance, error)
      },
    }
    instance = (this.options.createSidecar ?? (value => new ComposerSidecar(value)))(options)
    return instance
  }

  /** Restart with backoff; after the budget, restore client routing and stop trying. */
  private recover(failed: Sidecar, error: Error): void {
    if (this.#recovery !== undefined || this.#closed) return
    this.options.onBridgeUrl?.(undefined)
    if (this.#readyAt !== undefined && this.now() - this.#readyAt >= COMPOSER_HEALTHY_MS) this.#attempt = 0
    this.#readyAt = undefined
    this.#recovery = (async () => {
      await failed.stop().catch(() => { /* The process is already gone or will be killed. */ })
      const delay = COMPOSER_RESTART_DELAYS_MS[this.#attempt]
      if (delay === undefined) { await this.giveUp(error); return }
      this.#attempt += 1
      this.setStatus({ state: 'restarting', attempt: this.#attempt, error })
      await (this.options.delay ?? sleep)(delay)
      if (this.#closed) return
      this.#starting = undefined
    })().finally(() => { this.#recovery = undefined })
    void this.#recovery.then(() => {
      if (!this.#closed && this.#status.state === 'restarting') void this.start().catch(() => { /* Reported by spawn. */ })
    })
  }

  private async giveUp(error: Error): Promise<void> {
    this.#sidecar = undefined
    this.#starting = undefined
    let restoreError: Error | undefined
    let codexRestartRequired: boolean | undefined
    try {
      const restored = await (await this.createSidecar()).restore()
      codexRestartRequired = restored.codexRestartRequired
    } catch (failure) {
      restoreError = asError(failure)
      this.options.onError(restoreError)
    }
    if (this.#closed) return
    this.setStatus({
      state: 'failed', error,
      ...(restoreError === undefined ? {} : { restoreError }),
      ...(codexRestartRequired === undefined ? {} : { codexRestartRequired }),
    })
  }

  private setStatus(status: ComposerSurfaceStatus): void {
    this.#status = status
    this.options.onStatus?.(status)
  }

  private now(): number { return (this.options.now ?? Date.now)() }

  /**
   * Bridge one validated command for the Composer renderer.
   * @returns the renderer envelope.
   */
  async call(command: string, args: Record<string, unknown>) {
    try {
      await this.start()
      const sidecar = this.#sidecar
      if (sidecar === undefined) return composerBridgeError('app_not_ready', true)
      return await sidecar.invoke(command, args)
    } catch (_bridgeUnavailable) {
      return composerBridgeError('app_not_ready', this.#status.state !== 'failed')
    }
  }

  private invoke(event: IpcMainInvokeEvent, command: unknown, args: unknown) {
    if (!isComposerSender(event, this.view.contents)) throw new Error('Rejected Composer command')
    const request = composerInvokeRequest(command, args)
    if (request === undefined) return composerBridgeError('invalid_arguments')
    return this.call(request.command, request.args)
  }

  /** Remove the view and stop the sidecar. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.options.ipc !== false) {
      ipcMain.removeHandler(COMPOSER_IPC.invoke)
      ipcMain.removeHandler(COMPOSER_IPC.fatal)
      this.view.close()
    }
    this.options.onBridgeUrl?.(undefined)
    await this.#recovery
    await this.#sidecar?.stop()
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
