/** One-time notice that a separate Nexus Composer is keeping the embedded one read-only. */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { DesktopMessages } from './locale.ts'
import type { ComposerStandaloneState } from './composer-standalone.ts'

/** Marker file per detected kind, so seeing one notice never hides the other. */
export type ComposerStandaloneNoticePaths = Readonly<Record<ComposerStandaloneState, string>>

/** Shell dialog and the localized copy for each kind of standalone. */
export interface DesktopComposerStandaloneNoticeOptions {
  /** Marker files under Electron userData; one per kind of detected standalone. */
  readonly markerPaths: ComposerStandaloneNoticePaths
  readonly messages: () => DesktopMessages
  /** Native message box; the caller parents it to the main window when one exists. */
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  /** Raise an already-open prompt instead of stacking another. */
  readonly focus: () => void
}

/**
 * Show the "standalone detected" notice once per kind.
 *
 * Modelled on `background-notice.ts`: an acknowledged kind is recorded in a marker file, a cancelled or
 * failed prompt stays eligible for a later detection, and repeated detections coalesce while a prompt is
 * open (the other kind, if it appears meanwhile, is shown after). Superharness never signals the
 * standalone; the notice only explains why the embedded Composer is read-only.
 */
export class DesktopComposerStandaloneNotice {
  private readonly acknowledged = new Set<ComposerStandaloneState>()
  private readonly queued = new Set<ComposerStandaloneState>()
  private showing: ComposerStandaloneState | undefined
  private disposed = false

  /** @param options - Marker paths, localized copy, and the shell dialog. */
  constructor(private readonly options: DesktopComposerStandaloneNoticeOptions) {}

  /**
   * Report a detected external standalone. Only the first sighting of each kind prompts.
   * @param state - `handoff` or `outdated`, from {@link classifyComposerStandalone}.
   */
  report(state: ComposerStandaloneState): void {
    if (this.disposed || this.acknowledged.has(state)) return
    if (existsSync(this.options.markerPaths[state])) { this.acknowledged.add(state); return }
    if (this.showing === state) { this.options.focus(); return }
    if (this.showing !== undefined) { this.queued.add(state); return }
    void this.show(state)
  }

  /** Ignore late dialog responses after application shutdown begins. */
  dispose(): void { this.disposed = true }

  private async show(state: ComposerStandaloneState): Promise<void> {
    this.showing = state
    try {
      const messages = this.options.messages()
      // The outdated release additionally cannot hand over, so it says so.
      const message = state === 'outdated'
        ? `${messages.composerStandaloneNoticeDetail} ${messages.composerStandaloneNoticeOutdated}`
        : messages.composerStandaloneNoticeDetail
      const result = await this.options.show({
        type: 'info', title: messages.composerStandaloneNoticeTitle, message,
        buttons: [messages.updateAcknowledge], defaultId: 0, cancelId: -1,
      })
      if (this.disposed || result.response !== 0) return
      this.acknowledged.add(state)
      try {
        mkdirSync(dirname(this.options.markerPaths[state]), { recursive: true })
        writeFileSync(this.options.markerPaths[state], '')
      } catch (error) { console.warn('desktop composer: could not record standalone notice', error) }
    } catch (error) { console.warn('desktop composer: standalone notice unavailable', error) }
    finally {
      this.showing = undefined
      const next = [...this.queued].find(candidate => !this.acknowledged.has(candidate))
      if (next !== undefined) { this.queued.delete(next); this.report(next) }
      this.queued.clear()
    }
  }
}
