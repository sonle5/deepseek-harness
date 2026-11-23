/** Release Composer's client routing before Superharness quits or installs an update. */

import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { ComposerRelease } from './composer-sidecar.ts'
import type { DesktopMessages } from './locale.ts'

/** The live sidecar's release requests; absent while no sidecar serves, when nothing is routed. */
export interface ComposerReleaseTarget {
  release(): Promise<ComposerRelease>
  codexDecision(decision: 'continue' | 'resume'): Promise<ComposerRelease>
}

export interface ComposerQuitOptions {
  readonly target: () => ComposerReleaseTarget | undefined
  readonly messages: () => DesktopMessages
  /** Native message box, as the quit confirmation shows it. */
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  readonly onError?: (error: Error) => void
}

/**
 * Release Composer routing, asking only when Codex Desktop must restart to stop using the Composer proxy.
 * A failed release never blocks quitting: the sidecar retries a bounded release when it receives shutdown.
 * @returns false when the user chose to keep Composer serving Codex, which cancels the quit.
 */
export async function releaseComposerForQuit(options: ComposerQuitOptions): Promise<boolean> {
  const target = options.target()
  if (target === undefined) return true
  const outcome = await settle(target.release(), options)
  if (outcome.status !== 'awaitingCodexDecision') return true
  const messages = options.messages()
  const { response } = await options.show({
    type: 'warning',
    title: messages.aboutProduct,
    message: messages.composerCodexRestartTitle,
    detail: messages.composerCodexRestartDetail,
    buttons: [messages.quitAnyway, messages.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  const decision = response === 0 ? 'continue' : 'resume'
  // A failed resume still honours Cancel: the application and its sidecar keep running.
  await settle(target.codexDecision(decision), options)
  return decision === 'continue'
}

async function settle(request: Promise<ComposerRelease>, options: ComposerQuitOptions): Promise<ComposerRelease> {
  try {
    const outcome = await request
    if (outcome.status === 'failed') options.onError?.(new Error(`nexus composer release failed: ${outcome.error}`))
    return outcome
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    options.onError?.(failure)
    return { status: 'failed', error: failure.message }
  }
}
