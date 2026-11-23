import { describe, expect, it, vi } from 'vitest'
import type { ComposerEventSocketHandlers, ComposerEventsEndpoint } from '../src/composer-events.ts'

vi.mock('electron', () => ({}))

const { ComposerEventForwarder, COMPOSER_EVENTS_RETRY_DELAYS_MS, parseComposerEvent } = await import('../src/composer-events.ts')
const { COMPOSER_IPC } = await import('../src/composer-ipc.ts')

const ENDPOINT = { url: 'ws://127.0.0.1:4321/v1/events', authorization: 'Bearer s' }

function harness() {
  const sockets: Array<{ endpoint: ComposerEventsEndpoint; handlers: ComposerEventSocketHandlers; close: ReturnType<typeof vi.fn> }> = []
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
  const errors: Error[] = []
  let destroyed = false
  let present = true
  const contents = { isDestroyed: () => destroyed, send: vi.fn() }
  const forwarder = new ComposerEventForwarder({
    target: () => present ? contents as never : undefined,
    onError: (error) => { errors.push(error) },
    createSocket: (endpoint, handlers) => {
      const entry = { endpoint, handlers, close: vi.fn() }
      sockets.push(entry)
      return entry
    },
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
  })
  return {
    forwarder, sockets, timers, errors, contents,
    destroy: () => { destroyed = true }, remove: () => { present = false },
  }
}

describe('composer event frames', () => {
  it('accepts only { event, payload }', () => {
    expect(parseComposerEvent('{"event":"provider-switched","payload":{"id":1}}')).toEqual({ event: 'provider-switched', payload: { id: 1 } })
    expect(parseComposerEvent('{"event":"x","payload":null}')).toEqual({ event: 'x', payload: null })
    for (const text of ['not json', '[]', 'null', '"x"', '{"event":1,"payload":0}', '{"event":"x"}',
      '{"event":"x","payload":1,"extra":2}', '{"event":"","payload":1}', '{"event":"bad name","payload":1}']) {
      expect(parseComposerEvent(text)).toBeUndefined()
    }
  })
})

describe('composer event forwarder', () => {
  it('opens one authorized socket and forwards valid frames to the view', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    expect(h.sockets).toHaveLength(1)
    expect(h.sockets[0]?.endpoint).toEqual(ENDPOINT)
    h.sockets[0]?.handlers.open()
    h.sockets[0]?.handlers.message('{"event":"usage-cache-updated","payload":[1]}')
    expect(h.contents.send).toHaveBeenCalledWith(COMPOSER_IPC.event, { event: 'usage-cache-updated', payload: [1] })
  })

  it('ignores malformed frames without throwing', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    for (const text of ['{', '{"event":5,"payload":1}', '{"payload":1}', '']) {
      expect(() => h.sockets[0]?.handlers.message(text)).not.toThrow()
    }
    expect(h.contents.send).not.toHaveBeenCalled()
  })

  it('does not send after the view is destroyed or gone', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    h.destroy()
    h.sockets[0]?.handlers.message('{"event":"a","payload":1}')
    h.remove()
    h.sockets[0]?.handlers.message('{"event":"a","payload":1}')
    expect(h.contents.send).not.toHaveBeenCalled()
  })

  it('closes the socket when the sidecar stops and ignores its later frames and drop', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    const socket = h.sockets[0]
    h.forwarder.disconnect()
    expect(socket?.close).toHaveBeenCalledOnce()
    socket?.handlers.message('{"event":"a","payload":1}')
    socket?.handlers.close()
    expect(h.contents.send).not.toHaveBeenCalled()
    expect(h.timers).toHaveLength(0)
  })

  it('opens a new socket for each ready, closing the previous one', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    const second = { url: 'ws://127.0.0.1:9999/v1/events', authorization: 'Bearer t' }
    h.forwarder.connect(second)
    expect(h.sockets[0]?.close).toHaveBeenCalledOnce()
    expect(h.sockets[1]?.endpoint).toEqual(second)
    h.sockets[0]?.handlers.message('{"event":"old","payload":1}')
    h.sockets[1]?.handlers.message('{"event":"new","payload":1}')
    expect(h.contents.send.mock.calls).toEqual([[COMPOSER_IPC.event, { event: 'new', payload: 1 }]])
  })

  it('reconnects a dropped socket with backoff, then reports', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    for (let attempt = 0; attempt < COMPOSER_EVENTS_RETRY_DELAYS_MS.length; attempt += 1) {
      h.sockets.at(-1)?.handlers.close()
      expect(h.timers.at(-1)?.ms).toBe(COMPOSER_EVENTS_RETRY_DELAYS_MS[attempt])
      h.timers.at(-1)?.run()
    }
    expect(h.sockets).toHaveLength(COMPOSER_EVENTS_RETRY_DELAYS_MS.length + 1)
    expect(h.errors).toHaveLength(0)
    h.sockets.at(-1)?.handlers.close()
    expect(h.errors.map(error => error.message)).toEqual(['nexus composer event stream disconnected'])
  })

  it('a successful reconnect earns a fresh retry budget', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    h.sockets[0]?.handlers.close()
    h.timers[0]?.run()
    h.sockets[1]?.handlers.open()
    h.sockets[1]?.handlers.close()
    expect(h.timers[1]?.ms).toBe(COMPOSER_EVENTS_RETRY_DELAYS_MS[0])
  })

  it('cancels a pending retry on disconnect', () => {
    const h = harness()
    h.forwarder.connect(ENDPOINT)
    h.sockets[0]?.handlers.close()
    h.forwarder.disconnect()
    expect(h.timers[0]?.cancelled).toBe(true)
    h.timers[0]?.run()
    expect(h.sockets).toHaveLength(1)
  })
})
