/** IPC contract between the Composer preload and the main process; safe to bundle into a sandboxed preload. */

export const COMPOSER_IPC = {
  /** renderer → main: `(command, args)` → renderer invoke envelope. */
  invoke: 'dsh-composer:invoke',
  /** renderer → main: unrecoverable startup error `{ title, message }`. */
  fatal: 'dsh-composer:fatal',
  /** main → renderer: backend event `{ event, payload }`. */
  event: 'dsh-composer:event',
} as const

/** Host protocol the Composer renderer expects (`src/lib/transport/host.ts` in Composer). */
export const COMPOSER_HOST_PROTOCOL = 1
