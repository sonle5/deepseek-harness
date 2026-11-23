/**
 * Composer commands the Electron shell owns: native dialogs, the OS opener, the clipboard and restart.
 * They never reach the sidecar; arguments and results match the original Tauri commands.
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { clipboard, dialog, shell, type BaseWindow, type FileFilter } from 'electron'
import type { ComposerInvokeResult } from './composer-sidecar.ts'

/** Commands answered in the main process; the sidecar never sees them. */
export const COMPOSER_SHELL_COMMANDS: readonly string[] = Object.freeze([
  'pick_directory', 'open_file_dialog', 'save_file_dialog', 'open_zip_file_dialog', 'open_external',
  'open_config_folder', 'open_app_config_folder', 'copy_text_to_clipboard', 'restart_app',
])

/**
 * @param command - Validated command name.
 * @returns whether the shell answers it.
 */
export function isComposerShellCommand(command: string): boolean {
  return COMPOSER_SHELL_COMMANDS.includes(command)
}

/** Restart is answered first and runs after the response, like Tauri's 100 ms deferred `app.restart()`. */
export const COMPOSER_RESTART_DEFER_MS = 100

const SQL_FILTER: FileFilter[] = [{ name: 'SQL', extensions: ['sql'] }]
const ZIP_FILTER: FileFilter[] = [{ name: 'ZIP / Skill', extensions: ['zip', 'skill'] }]

/** Native facilities the handlers use; tests replace them. */
export interface ComposerShellOptions {
  /** Parent for dialogs; dialogs open unparented while there is none. */
  readonly window: () => BaseWindow | undefined
  /** Read-only sidecar command used to resolve Composer-owned paths. */
  readonly bridge: (command: string, args: Record<string, unknown>) => Promise<ComposerInvokeResult>
  /** Restart the sidecar (not Superharness). */
  readonly restart: () => Promise<unknown>
  /** A deferred restart failed. */
  readonly onError: (error: Error) => void
  readonly dialog?: Pick<typeof dialog, 'showOpenDialog' | 'showSaveDialog'>
  readonly shell?: Pick<typeof shell, 'openExternal' | 'openPath'>
  readonly clipboard?: Pick<typeof clipboard, 'writeText'>
  readonly mkdir?: (path: string) => Promise<unknown>
  readonly defer?: (run: () => void, ms: number) => void
}

const invalidArguments: ComposerInvokeResult = { bridgeError: { code: 'invalid_arguments', retryable: false } }

/** Answers {@link COMPOSER_SHELL_COMMANDS} in the renderer envelope. */
export class ComposerShell {
  constructor(private readonly options: ComposerShellOptions) {}

  /**
   * Run one shell command.
   * @param command - One of {@link COMPOSER_SHELL_COMMANDS}.
   * @param args - camelCase arguments, as Tauri `invoke` takes them.
   * @returns the renderer envelope; command errors are raw strings like the Tauri originals.
   */
  async call(command: string, args: Record<string, unknown>): Promise<ComposerInvokeResult> {
    try {
      return await this.dispatch(command, args)
    } catch (error) {
      // Tauri serialized a command failure as its error string; never reject the renderer's invoke.
      return { err: message(error) }
    }
  }

  private async dispatch(command: string, args: Record<string, unknown>): Promise<ComposerInvokeResult> {
    switch (command) {
      case 'pick_directory': return this.pickDirectory(args.defaultPath)
      case 'open_file_dialog': return this.openFile(SQL_FILTER)
      case 'open_zip_file_dialog': return this.openFile(ZIP_FILTER)
      case 'save_file_dialog': return this.saveFile(args.defaultName)
      case 'open_external': return this.openExternal(args.url)
      case 'open_config_folder': {
        if (typeof args.app !== 'string') return invalidArguments
        return this.openFolder(await this.options.bridge('get_config_dir', { app: args.app }), path => path)
      }
      case 'open_app_config_folder':
        // `get_app_config_path` is `<app config dir>/config.json`; its parent is the folder Tauri opened.
        return this.openFolder(await this.options.bridge('get_app_config_path', {}), path => dirname(path))
      case 'copy_text_to_clipboard': return this.copyText(args.text)
      case 'restart_app': return this.restartApp()
      default: return { bridgeError: { code: 'unknown_command', retryable: false } }
    }
  }

  private get dialog() { return this.options.dialog ?? dialog }
  private get shell() { return this.options.shell ?? shell }

  private parent(): BaseWindow | undefined {
    const window = this.options.window()
    return window === undefined || window.isDestroyed() ? undefined : window
  }

  private async pickDirectory(defaultPath: unknown): Promise<ComposerInvokeResult> {
    if (defaultPath !== undefined && defaultPath !== null && typeof defaultPath !== 'string') return invalidArguments
    const initial = typeof defaultPath === 'string' && defaultPath.trim() !== '' ? defaultPath.trim() : undefined
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      ...(initial === undefined ? {} : { defaultPath: initial }),
    }
    const parent = this.parent()
    const { canceled, filePaths } = parent === undefined
      ? await this.dialog.showOpenDialog(options) : await this.dialog.showOpenDialog(parent, options)
    return { ok: canceled ? null : filePaths[0] ?? null }
  }

  private async openFile(filters: FileFilter[]): Promise<ComposerInvokeResult> {
    const options = { properties: ['openFile'] as Array<'openFile'>, filters }
    const parent = this.parent()
    const { canceled, filePaths } = parent === undefined
      ? await this.dialog.showOpenDialog(options) : await this.dialog.showOpenDialog(parent, options)
    return { ok: canceled ? null : filePaths[0] ?? null }
  }

  private async saveFile(defaultName: unknown): Promise<ComposerInvokeResult> {
    if (typeof defaultName !== 'string') return invalidArguments
    const options = { filters: SQL_FILTER, defaultPath: defaultName }
    const parent = this.parent()
    const { canceled, filePath } = parent === undefined
      ? await this.dialog.showSaveDialog(options) : await this.dialog.showSaveDialog(parent, options)
    return { ok: canceled || filePath === '' ? null : filePath }
  }

  private async openExternal(url: unknown): Promise<ComposerInvokeResult> {
    if (typeof url !== 'string') return invalidArguments
    // Tauri prefixed a scheme-less link with https://; only https leaves the shell.
    const candidate = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    let destination: URL
    try { destination = new URL(candidate) } catch (_invalidUrl) { return { err: 'Failed to open link: invalid URL' } }
    if (destination.protocol !== 'https:' || destination.username !== '' || destination.password !== '') {
      return { err: 'Failed to open link: only https links can be opened' }
    }
    try {
      await this.shell.openExternal(destination.href)
      return { ok: true }
    } catch (error) {
      return { err: `Failed to open link: ${message(error)}` }
    }
  }

  private async openFolder(resolved: ComposerInvokeResult, folder: (path: string) => string): Promise<ComposerInvokeResult> {
    if (!('ok' in resolved)) return resolved
    if (typeof resolved.ok !== 'string' || resolved.ok === '') return { err: 'Failed to open folder: the folder is unknown' }
    const path = folder(resolved.ok)
    try {
      await (this.options.mkdir ?? (target => mkdir(target, { recursive: true })))(path)
    } catch (error) {
      return { err: `Failed to create directory: ${message(error)}` }
    }
    const failure = await this.shell.openPath(path)
    return failure === '' ? { ok: true } : { err: `Failed to open folder: ${failure}` }
  }

  private async copyText(text: unknown): Promise<ComposerInvokeResult> {
    if (typeof text !== 'string') return invalidArguments
    try {
      await (this.options.clipboard ?? clipboard).writeText(text)
      return { ok: true }
    } catch (error) {
      return { err: `Failed to write to system clipboard: ${message(error)}` }
    }
  }

  private restartApp(): ComposerInvokeResult {
    (this.options.defer ?? ((run, ms) => { setTimeout(run, ms) }))(() => {
      this.options.restart().catch((error: unknown) => { this.options.onError(error instanceof Error ? error : new Error(String(error))) })
    }, COMPOSER_RESTART_DEFER_MS)
    return { ok: true }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
