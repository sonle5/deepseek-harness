/** Wires the Composer sidecar, its view and the preload IPC into the application lifetime. */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ComposerSidecar, type ComposerReady } from './composer-sidecar.ts'
import { COMPOSER_IPC } from './composer-ipc.ts'
import {
  DesktopComposerView, composerBridgeError, composerInvokeRequest, isComposerSender, type ComposerResources,
} from './composer-view.ts'

export interface ComposerSurfaceOptions {
  readonly resources: ComposerResources
  /** Bundled `preload-composer.js`. */
  readonly preload: string
  /** Isolated storage root; the sidecar refuses to run against the shared profile until it holds the owner lock. */
  readonly home: string
  /** Composer-scoped failure: never a reason to stop Superharness. */
  readonly onError: (error: Error) => void
}

/** Composer inside Superharness: one sidecar, one view. */
export class DesktopComposerSurface {
  readonly view: DesktopComposerView
  readonly #sidecar: ComposerSidecar
  #starting: Promise<ComposerReady> | undefined
  #closed = false

  constructor(private readonly options: ComposerSurfaceOptions) {
    this.#sidecar = new ComposerSidecar({
      binary: options.resources.binary,
      home: options.home,
      onFailure: (error) => { options.onError(error) },
    })
    this.view = new DesktopComposerView(options.preload, options.resources.dist, ({ title, message }) => {
      options.onError(new Error(`${title}: ${message}`))
    })
    ipcMain.handle(COMPOSER_IPC.invoke, (event, command: unknown, args: unknown) => this.invoke(event, command, args))
    ipcMain.handle(COMPOSER_IPC.fatal, (event, error: unknown) => {
      if (isComposerSender(event, this.view.contents)) this.view.reportFatal(error)
    })
  }

  /** Start the sidecar once; failures are reported, not thrown into application startup. */
  start(): Promise<ComposerReady> {
    if (this.#closed) return Promise.reject(new Error('nexus composer surface is closed'))
    return this.#starting ??= this.#sidecar.start().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.options.onError(failure)
      throw failure
    })
  }

  private async invoke(event: IpcMainInvokeEvent, command: unknown, args: unknown) {
    if (!isComposerSender(event, this.view.contents)) throw new Error('Rejected Composer command')
    const request = composerInvokeRequest(command, args)
    if (request === undefined) return composerBridgeError('invalid_arguments')
    try {
      await this.start()
      return await this.#sidecar.invoke(request.command, request.args)
    } catch (_bridgeUnavailable) {
      return composerBridgeError('app_not_ready', true)
    }
  }

  /** Remove the view and stop the sidecar. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    ipcMain.removeHandler(COMPOSER_IPC.invoke)
    ipcMain.removeHandler(COMPOSER_IPC.fatal)
    this.view.close()
    await this.#sidecar.stop()
  }
}
