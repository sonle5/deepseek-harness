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
  z.object({ type: z.literal('exiting'), reason: z.string() }),
  z.object({ type: z.literal('error'), code: z.string() }).loose(),
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

/** Process facts the supervisor needs; tests replace the spawn. */
export interface ComposerSidecarOptions {
  /** Composer executable. */
  readonly binary: string
  /** Isolated storage root passed as `NEXUS_COMPOSER_HOME`. */
  readonly home: string
  readonly environment?: NodeJS.ProcessEnv
  /** Failure after a successful start; the shell scopes it to the Composer surface. */
  readonly onFailure?: (error: Error) => void
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
      const child = (this.options.spawn ?? defaultSpawn)(this.options.binary, ['--sidecar'], env)
      this.#child = child
      let authenticated = false
      const timer = setTimeout(() => { fail(new Error('nexus composer sidecar did not become ready')) }, this.options.startupTimeoutMs ?? 60_000)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        const settledBefore = this.#ready !== undefined
        reject(error)
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
        }
        // `exiting` precedes 'close'; `error` frames answer requests this shell does not send yet.
      })
    })
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

async function exitsWithin(exited: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false) }, ms) })
  try { return await Promise.race([exited.then(() => true as const), timeout]) } finally { clearTimeout(timer) }
}
