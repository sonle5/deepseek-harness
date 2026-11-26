/** Forwards the sidecar's backend events (`/v1/events`) to the Composer view, one socket per serving sidecar. */

import WebSocket from 'ws'
import type { WebContents } from 'electron'
import { COMPOSER_IPC } from './composer-ipc.ts'

/** Delays before each reconnect of a socket that dropped while its sidecar still serves. */
export const COMPOSER_EVENTS_RETRY_DELAYS_MS: readonly number[] = [500, 2_000, 5_000]

const MAX_EVENT_FRAME_BYTES = 1024 * 1024
/** Tauri event names: alphanumerics plus `-`, `/`, `:` and `_`. */
const EVENT_NAME = /^[A-Za-z0-9\-/:_]{1,128}$/

/** One backend event, as the Composer preload dispatches it. */
export interface ComposerEvent { readonly event: string; readonly payload: unknown }

/** Where the serving sidecar streams events; the authorization header carries the bridge secret. */
export interface ComposerEventsEndpoint { readonly url: string; readonly authorization: string }

/** Callbacks a socket reports to; each fires at most as the transport allows, `close` exactly once. */
export interface ComposerEventSocketHandlers {
  readonly open: () => void
  readonly message: (text: string) => void
  readonly close: () => void
}

/** Opens one event socket; tests replace it. */
export type ComposerEventSocketFactory = (endpoint: ComposerEventsEndpoint, handlers: ComposerEventSocketHandlers) => { close(): void }

/**
 * Decode one text frame strictly.
 * @param text - Frame text.
 * @returns the event, or undefined for anything but `{ "event": string, "payload": any }`.
 */
export function parseComposerEvent(text: string): ComposerEvent | undefined {
  if (text.length > MAX_EVENT_FRAME_BYTES) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch (_invalidJson) { return undefined }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('event') || !keys.includes('payload')) return undefined
  const { event, payload } = value as { event: unknown; payload: unknown }
  if (typeof event !== 'string' || !EVENT_NAME.test(event)) return undefined
  return { event, payload }
}

/**
 * Default socket on the `ws` package, which accepts the authorization header the browser-style
 * `WebSocket` constructor cannot send.
 */
export const openComposerEventSocket: ComposerEventSocketFactory = (endpoint, handlers) => {
  const socket = new WebSocket(endpoint.url, {
    headers: { authorization: endpoint.authorization }, maxPayload: MAX_EVENT_FRAME_BYTES, followRedirects: false,
  })
  socket.on('open', () => { handlers.open() })
  socket.on('message', (data, isBinary) => {
    if (isBinary) return
    handlers.message(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8'))
  })
  // 'close' follows every 'error', including a failed handshake.
  socket.on('error', () => { /* Reported through 'close'. */ })
  socket.on('close', () => { handlers.close() })
  return { close: () => { socket.terminate() } }
}

export interface ComposerEventForwarderOptions {
  /** Live Composer view contents, if any. */
  readonly target: () => WebContents | undefined
  /** The socket stayed down after every retry while the sidecar still served. */
  readonly onError: (error: Error) => void
  readonly createSocket?: ComposerEventSocketFactory
  /** Schedules a retry; returns a cancel. */
  readonly schedule?: (run: () => void, ms: number) => () => void
}

/** Owns at most one event socket; its lifetime follows the serving sidecar. */
export class ComposerEventForwarder {
  #generation = 0
  #socket: { close(): void } | undefined
  #cancelRetry: (() => void) | undefined

  constructor(private readonly options: ComposerEventForwarderOptions) {}

  /**
   * Follow a newly ready sidecar, closing the previous socket.
   * @param endpoint - The sidecar's event stream; undefined only disconnects.
   */
  connect(endpoint: ComposerEventsEndpoint | undefined): void {
    this.disconnect()
    if (endpoint === undefined) return
    this.open(endpoint, this.#generation, 0)
  }

  /** Close the socket and cancel retries; later frames and drops of the old socket are ignored. */
  disconnect(): void {
    this.#generation += 1
    this.#cancelRetry?.()
    this.#cancelRetry = undefined
    const socket = this.#socket
    this.#socket = undefined
    try { socket?.close() } catch (_alreadyClosed) { /* Nothing left to release. */ }
  }

  private open(endpoint: ComposerEventsEndpoint, generation: number, attempt: number): void {
    let retries = attempt
    const current = (): boolean => generation === this.#generation
    try {
      this.#socket = (this.options.createSocket ?? openComposerEventSocket)(endpoint, {
        open: () => { if (current()) retries = 0 },
        message: (text) => { if (current()) this.forward(text) },
        close: () => { if (current()) this.dropped(endpoint, generation, retries) },
      })
    } catch (_connectFailed) {
      this.dropped(endpoint, generation, retries)
    }
  }

  private dropped(endpoint: ComposerEventsEndpoint, generation: number, attempt: number): void {
    this.#socket = undefined
    const delay = COMPOSER_EVENTS_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      this.options.onError(new Error('nexus composer event stream disconnected'))
      return
    }
    const schedule = this.options.schedule ?? ((run, ms) => {
      const timer = setTimeout(run, ms)
      return () => { clearTimeout(timer) }
    })
    this.#cancelRetry = schedule(() => {
      this.#cancelRetry = undefined
      if (generation === this.#generation) this.open(endpoint, generation, attempt + 1)
    }, delay)
  }

  private forward(text: string): void {
    const event = parseComposerEvent(text)
    if (event === undefined) return
    const contents = this.options.target()
    if (contents === undefined || contents.isDestroyed()) return
    try {
      contents.send(COMPOSER_IPC.event, { event: event.event, payload: event.payload })
    } catch (_viewGone) { /* The view closed between the check and the send. */ }
  }
}
