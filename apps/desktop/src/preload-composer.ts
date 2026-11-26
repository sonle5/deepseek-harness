/** Sandboxed preload of the Composer view: exposes `window.nexusComposerHost` to the Composer renderer. */

import { contextBridge, ipcRenderer } from 'electron'
import { COMPOSER_HOST_PROTOCOL, COMPOSER_IPC } from './composer-ipc.ts'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()

ipcRenderer.on(COMPOSER_IPC.event, (_event, message: unknown) => {
  if (typeof message !== 'object' || message === null) return
  const { event, payload } = message as { event?: unknown; payload?: unknown }
  if (typeof event !== 'string') return
  for (const handler of handlers.get(event) ?? []) {
    try { handler(payload) } catch (error) { console.error('Composer event handler failed', error) }
  }
})

if (location.protocol === 'dsh-app:' && location.host === 'composer') {
  contextBridge.exposeInMainWorld('nexusComposerHost', {
    protocol: COMPOSER_HOST_PROTOCOL,
    invoke: (command: string, args?: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke(COMPOSER_IPC.invoke, command, args),
    listen: (event: string, handler: Handler): (() => void) => {
      let set = handlers.get(event)
      if (set === undefined) handlers.set(event, set = new Set())
      set.add(handler)
      return () => { set.delete(handler) }
    },
    fatal: (error: { title: string; message: string }): void => {
      void ipcRenderer.invoke(COMPOSER_IPC.fatal, error)
    },
  })
}
