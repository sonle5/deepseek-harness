/** Lifecycle of the windowless Nexus Composer sidecar and its loopback command bridge. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { z } from 'zod'

/** Control and bridge contract version this shell speaks (`src-tauri/src/sidecar/mod.rs`). */
export const COMPOSER_BRIDGE_PROTOCOL = 1

const MAX_DIAGNOSTIC_CHARS = 64 * 1024
const MAX_FRAME_CHARS = 64 * 1024
const COMMAND_NAME = /^[a-z][a-z0-9_]*$/
/** Release restores client profiles and may wait on SQLite; give it more than the 3 s OS budget. */
const REQUEST_TIMEOUT_MS = 30_000

/** Startup status the sidecar reports when setup stopped early, for example a database newer than supported. */
export type ComposerInitStatus = Readonly<Record<string, unknown>> | null

export interface ComposerReady {
  readonly url: string
  readonly version: string
  readonly schemaVersion: number
  readonly initStatus: ComposerInitStatus
  readonly ownership: string
}

/** Result envelope handed to the Composer renderer (`src/lib/transport/host.ts` in Composer). */
export type ComposerInvokeResult =
  | { readonly ok: unknown }
  | { readonly err: unknown }
  | { readonly bridgeError: { readonly code: string; readonly retryable: boolean } }

/** Outcome of a quit release step; `awaitingCodexDecision` asks the user whether to restart Codex Desktop first. */
export type ComposerRelease =
  | { readonly status: 'released' | 'awaitingCodexDecision' | 'cancelled' }
  | { readonly status: 'failed'; readonly error: string }

const requestId = z.number().int().nonnegative().optional()

const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('starting'), version: z.string() }),
  z.object({
    type: z.literal('ready'),
    url: z.string(),
    version: z.string(),
    bridgeProtocol: z.number(),
    schemaVersion: z.number(),
    initStatus: z.record(z.string(), z.unknown()).nullable(),
    ownership: z.string(),
  }),
  z.object({ type: z.literal('ownership'), ownership: z.string(), reason: z.string() }),
  z.object({ type: z.literal('exiting'), reason: z.string() }),
  z.object({ type: z.literal('quit-inspection'), id: requestId, routedClients: z.array(z.string()) }),
  z.object({ type: z.literal('released'), id: requestId }),
  z.object({ type: z.literal('awaiting-codex-decision'), id: requestId }),
  z.object({ type: z.literal('release-cancelled'), id: requestId }),
  z.object({ type: z.literal('release-failed'), id: requestId, error: z.string() }),
  z.object({ type: z.literal('error'), id: requestId, code: z.string() }).loose(),
  z.object({
    type: z.literal('restored'), ownership: z.string(), codexRestartRequired: z.boolean(),
    initStatus: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  z.object({ type: z.literal('restore-failed'), error: z.string() }),
])

export type ComposerFrame = z.infer<typeof frameSchema>

/**
 * Decode one stdout line. Stdout belongs to the control channel alone, so anything else is a protocol violation.
 * @param line - One newline-delimited stdout line.
 * @returns the frame, or undefined for an invalid line.
 */
export function parseComposerFrame(line: string): ComposerFrame | undefined {
  if (line.length > MAX_FRAME_CHARS) return undefined
  let value: unknown
  try { value = JSON.parse(line) } catch (_invalidJson) { return undefined }
  const parsed = frameSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * Accept only a bare loopback origin, mirroring the Host URL rule in `host-process.ts`.
 * @param value - URL announced by the sidecar.
 */
export function isOwnedComposerUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== ''
      && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === ''
  } catch (_invalidUrl) {
    return false
  }
}

/** Result of `--restore-and-exit`: every client route this profile owned was released. */
export interface ComposerRestored {
  readonly ownership: string
  /** Codex Desktop kept running against the released route and needs a restart. */
  readonly codexRestartRequired: boolean
}

/** Process facts the supervisor needs; tests replace the spawn. */
export interface ComposerSidecarOptions {
  /** Composer executable. */
  readonly binary: string
  /** Isolated storage root passed as `NEXUS_COMPOSER_HOME`. */
  readonly home: string
  readonly environment?: NodeJS.ProcessEnv
  /** Failure after a successful start; the shell scopes it to the Composer surface. */
  readonly onFailure?: (error: Error) => void
  /** Ownership changed after ready, for example another Composer took over routing and the bridge became read-only. */
  readonly onOwnership?: (ownership: string, reason: string) => void
  readonly spawn?: (binary: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams
  readonly fetch?: typeof fetch
  readonly startupTimeoutMs?: number
}

function defaultSpawn(binary: string, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
}

/** One sidecar process: handshake, bridge calls and teardown. */
export class ComposerSidecar {
  readonly #secret = randomBytes(32).toString('base64url')
  #child: ChildProcessWithoutNullStreams | undefined
  #ready: ComposerReady | undefined
  #readyPromise: Promise<ComposerReady> | undefined
  #exited: Promise<void> | undefined
  #stderr = ''
  #stopping = false
  #failed = false
  #nextRequest = 0
  #restoring = false
  #restored: ((frame: ComposerRestored) => void) | undefined
  readonly #pending = new Map<number, { resolve: (frame: ComposerFrame) => void; reject: (error: Error) => void }>()

  constructor(private readonly options: ComposerSidecarOptions) {}

  /** Ready facts once the handshake completed. */
  get ready(): ComposerReady | undefined { return this.#ready }

  /** Bounded stderr tail for diagnostics; never contains the secret, which travels on stdin only. */
  get diagnostics(): string { return this.#stderr }

  /**
   * Spawn once and complete the control handshake.
   * @returns ready facts announced by the sidecar.
   */
  start(): Promise<ComposerReady> {
    return this.#readyPromise ??= new Promise<ComposerReady>((resolve, reject) => {
      const env = { ...this.options.environment ?? process.env, NEXUS_COMPOSER_HOME: this.options.home }
      const child = (this.options.spawn ?? defaultSpawn)(this.options.binary, this.#restoring ? ['--sidecar', '--restore-and-exit'] : ['--sidecar'], env)
      this.#child = child
      let authenticated = false
      const timer = setTimeout(() => { fail(new Error('nexus composer sidecar did not become ready')) }, this.options.startupTimeoutMs ?? 60_000)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        const settledBefore = this.#ready !== undefined
        reject(error)
        for (const pending of this.#pending.values()) pending.reject(error)
        this.#pending.clear()
        if (!this.#failed && !this.#stopping) {
          this.#failed = true
          child.kill('SIGTERM')
          if (settledBefore) this.options.onFailure?.(error)
        }
      }
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { this.#stderr = (this.#stderr + chunk).slice(-MAX_DIAGNOSTIC_CHARS) })
      child.stdin.on('error', () => { /* Exit is reported through 'close'. */ })
      child.once('error', (error) => { fail(error) })
      this.#exited = new Promise<void>((exited) => {
        child.once('close', (code) => {
          const suffix = this.#stderr.trim() === '' ? '' : `: ${this.#stderr.trim().slice(-2_000)}`
          fail(new Error(`nexus composer sidecar exited with ${String(code)}${suffix}`))
          exited()
        })
      })
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
      lines.on('line', (line) => {
        const frame = parseComposerFrame(line)
        if (frame === undefined) { fail(new Error('nexus composer sidecar wrote an invalid control frame')); return }
        if (frame.type === 'starting') {
          if (authenticated) { fail(new Error('nexus composer sidecar restarted its handshake')); return }
          authenticated = true
          child.stdin.write(`${JSON.stringify({ type: 'auth', secret: this.#secret })}\n`)
        } else if (frame.type === 'ready') {
          if (!authenticated || this.#ready !== undefined) { fail(new Error('nexus composer sidecar sent an unexpected ready frame')); return }
          if (frame.bridgeProtocol !== COMPOSER_BRIDGE_PROTOCOL) {
            fail(new Error(`nexus composer sidecar speaks bridge protocol ${String(frame.bridgeProtocol)}, expected ${String(COMPOSER_BRIDGE_PROTOCOL)}`))
            return
          }
          if (!isOwnedComposerUrl(frame.url.endsWith('/') ? frame.url : `${frame.url}/`)) {
            fail(new Error('nexus composer sidecar announced a non-loopback bridge'))
            return
          }
          clearTimeout(timer)
          this.#ready = {
            url: frame.url.replace(/\/$/, ''), version: frame.version, schemaVersion: frame.schemaVersion,
            initStatus: frame.initStatus, ownership: frame.ownership,
          }
          resolve(this.#ready)
        } else if (frame.type === 'ownership') {
          if (this.#ready === undefined) { fail(new Error('nexus composer sidecar changed ownership before ready')); return }
          this.#ready = { ...this.#ready, ownership: frame.ownership }
          this.options.onOwnership?.(frame.ownership, frame.reason)
        } else if (frame.type === 'restored' || frame.type === 'restore-failed') {
          if (!this.#restoring || !authenticated) { fail(new Error('nexus composer sidecar sent an unexpected restore result')); return }
          clearTimeout(timer)
          if (frame.type === 'restore-failed') { fail(new Error(`nexus composer could not restore client routing: ${frame.error}`)); return }
          this.#stopping = true
          this.#restored?.({ ownership: frame.ownership, codexRestartRequired: frame.codexRestartRequired })
        } else if ('id' in frame && frame.id !== undefined) {
          const pending = this.#pending.get(frame.id)
          if (pending === undefined) { fail(new Error('nexus composer sidecar answered an unknown request')); return }
          this.#pending.delete(frame.id)
          pending.resolve(frame)
        }
        // `exiting` precedes 'close'; an `error` frame without an id answers no request of this shell.
      })
    })
  }

  /**
   * Run `--restore-and-exit` instead of serving: release client routing left by a crashed sidecar, then exit.
   * Use a fresh instance; it never serves the bridge.
   * @returns what the sidecar released once it exited.
   */
  async restore(): Promise<ComposerRestored> {
    if (this.#readyPromise !== undefined) throw new Error('nexus composer sidecar already started')
    this.#restoring = true
    const restored = new Promise<ComposerRestored>((resolve) => { this.#restored = resolve })
    // A restore never reaches ready; the start promise settles only with a failure, including the exit after success.
    const failed = this.start().then(() => { throw new Error('nexus composer sidecar served instead of restoring') })
    failed.catch(() => { /* Observed through the race below. */ })
    const outcome = await Promise.race([restored, failed])
    await this.#exited
    return outcome
  }

  /**
   * Invoke one Composer command over the bridge.
   * @param command - Tauri command name.
   * @param args - camelCase arguments, as Tauri `invoke` takes them.
   * @returns the renderer envelope; command errors keep their raw backend value.
   */
  async invoke(command: string, args: unknown): Promise<ComposerInvokeResult> {
    const ready = this.#ready
    if (ready === undefined || this.#failed || this.#stopping) return { bridgeError: { code: 'app_not_ready', retryable: true } }
    if (!COMMAND_NAME.test(command)) return { bridgeError: { code: 'unknown_command', retryable: false } }
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return { bridgeError: { code: 'invalid_arguments', retryable: false } }
    }
    const response = await (this.options.fetch ?? fetch)(`${ready.url}/v1/invoke/${command}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    })
    const body = await response.json() as Record<string, unknown>
    if (response.status === 200 && 'ok' in body) return { ok: body.ok }
    if (response.status === 422 && 'err' in body) return { err: body.err }
    const error = body.error as { code?: unknown; retryable?: unknown } | undefined
    return {
      bridgeError: {
        code: typeof error?.code === 'string' ? error.code : 'bridge_failed',
        retryable: error?.retryable === true,
      },
    }
  }

  /**
   * Clients whose live profile points at this sidecar's routing; quitting would release them.
   * @returns client identifiers such as `codex` or `claude-desktop`.
   */
  async inspectQuit(): Promise<string[]> {
    const frame = await this.#request({ type: 'inspect-quit' })
    if (frame.type !== 'quit-inspection') throw new Error(`nexus composer sidecar answered inspect-quit with ${frame.type}`)
    return frame.routedClients
  }

  /**
   * Release client routing before quit, without any Composer dialog.
   * @returns `awaitingCodexDecision` when Codex Desktop must restart; answer with {@link codexDecision}.
   */
  async release(): Promise<ComposerRelease> {
    return releaseOutcome(await this.#request({ type: 'release' }))
  }

  /**
   * Answer `awaitingCodexDecision`.
   * @param decision - `continue` finishes the release; `resume` serves Codex again and cancels the quit.
   */
  async codexDecision(decision: 'continue' | 'resume'): Promise<ComposerRelease> {
    return releaseOutcome(await this.#request({ type: 'codex-decision', decision }))
  }

  #request(frame: Record<string, unknown>): Promise<ComposerFrame> {
    const child = this.#child
    if (this.#ready === undefined || child === undefined || this.#failed || this.#stopping || !child.stdin.writable) {
      return Promise.reject(new Error('nexus composer sidecar is not running'))
    }
    const id = this.#nextRequest++
    return new Promise<ComposerFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`nexus composer sidecar did not answer ${String(frame.type)}`))
      }, REQUEST_TIMEOUT_MS)
      this.#pending.set(id, {
        resolve: (answer) => { clearTimeout(timer); resolve(answer) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      child.stdin.write(`${JSON.stringify({ ...frame, id })}\n`)
    })
  }

  /**
   * Ask for a clean exit, then escalate.
   * @returns when the process has exited.
   */
  async stop(): Promise<void> {
    const child = this.#child
    if (child === undefined || this.#exited === undefined) return
    this.#stopping = true
    if (child.exitCode === null && child.signalCode === null) {
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`)
      if (!await exitsWithin(this.#exited, 10_000)) {
        child.kill('SIGTERM')
        if (!await exitsWithin(this.#exited, 5_000)) {
          child.kill('SIGKILL')
          if (!await exitsWithin(this.#exited, 5_000)) throw new Error('nexus composer sidecar did not exit after SIGKILL')
        }
      }
    }
    await this.#exited
  }
}

function releaseOutcome(frame: ComposerFrame): ComposerRelease {
  switch (frame.type) {
    case 'released': return { status: 'released' }
    case 'awaiting-codex-decision': return { status: 'awaitingCodexDecision' }
    case 'release-cancelled': return { status: 'cancelled' }
    case 'release-failed': return { status: 'failed', error: frame.error }
    case 'error': return { status: 'failed', error: frame.code }
    default: throw new Error(`nexus composer sidecar answered a release with ${frame.type}`)
  }
}

async function exitsWithin(exited: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false) }, ms) })
  try { return await Promise.race([exited.then(() => true as const), timeout]) } finally { clearTimeout(timer) }
}
