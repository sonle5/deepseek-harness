import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSidecar, isOwnedComposerUrl, parseComposerFrame } from '../src/composer-sidecar.ts'

const READY = { type: 'ready', url: 'http://127.0.0.1:4321', version: '1.0.0', bridgeProtocol: 1, schemaVersion: 7, initStatus: null, ownership: 'isolated' }

/** Fake sidecar: records stdin lines and lets the test write stdout frames and exit. */
function fakeChild() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const written: string[] = []
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => { written.push(...chunk.split('\n').filter(line => line !== '')) })
  const child = Object.assign(new EventEmitter(), {
    stdin, stdout, stderr, exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn((signal: string) => { exit(null, signal) }),
  })
  const exit = (code: number | null, signal: string | null = null): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.exitCode = code
    child.signalCode = signal
    child.emit('close', code, signal)
  }
  stdin.on('finish', () => { if (written.some(line => line.includes('"shutdown"'))) exit(0) })
  return {
    child: child as unknown as ChildProcessWithoutNullStreams & { kill: ReturnType<typeof vi.fn> },
    frame: (value: unknown) => { stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`) },
    written, exit, stderr,
  }
}

type SetupOptions = Pick<ConstructorParameters<typeof ComposerSidecar>[0], 'fetch' | 'onFailure' | 'onOwnership'>

function setup(options: SetupOptions = {}) {
  const fake = fakeChild()
  const spawn = vi.fn((_binary: string, _args: readonly string[], _env: NodeJS.ProcessEnv) => fake.child)
  const sidecar = new ComposerSidecar({ binary: '/bin/composer', home: '/tmp/isolated', environment: { PATH: '/bin' }, spawn, ...options })
  return { sidecar, spawn, ...fake }
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

afterEach(() => { vi.restoreAllMocks() })

describe('composer control frames', () => {
  it('accepts only well-formed frames', () => {
    expect(parseComposerFrame(JSON.stringify(READY))).toMatchObject({ type: 'ready' })
    expect(parseComposerFrame('stray-child-stdout')).toBeUndefined()
    expect(parseComposerFrame('{"type":"ready","url":"x"}')).toBeUndefined()
    expect(parseComposerFrame(JSON.stringify({ type: 'starting', version: 'x'.repeat(70_000) }))).toBeUndefined()
  })

  it('requires a bare loopback bridge origin', () => {
    expect(isOwnedComposerUrl('http://127.0.0.1:4321/')).toBe(true)
    expect(isOwnedComposerUrl('http://localhost:4321/')).toBe(false)
    expect(isOwnedComposerUrl('http://user:pw@127.0.0.1:4321/')).toBe(false)
    expect(isOwnedComposerUrl('http://127.0.0.1:4321/v1')).toBe(false)
    expect(isOwnedComposerUrl('https://127.0.0.1:4321/')).toBe(false)
  })
})

describe('composer sidecar supervisor', () => {
  it('hands the secret over stdin only after starting, and resolves on ready', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    expect(f.sidecar.start()).toBe(ready)
    const [binary, args, env] = f.spawn.mock.calls[0] as [string, readonly string[], NodeJS.ProcessEnv]
    expect([binary, args]).toEqual(['/bin/composer', ['--sidecar']])
    expect(env.NEXUS_COMPOSER_HOME).toBe('/tmp/isolated')
    await flush()
    expect(f.written).toEqual([])
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    const auth = JSON.parse(f.written[0]) as { type: string; secret: string }
    expect(auth.type).toBe('auth')
    expect(auth.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(env)).not.toContain(auth.secret)
    f.frame(READY)
    await expect(ready).resolves.toMatchObject({ url: 'http://127.0.0.1:4321', schemaVersion: 7, initStatus: null })
  })

  it('passes no NEXUS_COMPOSER_HOME without a home, even when one is inherited', () => {
    const fake = fakeChild()
    const spawn = vi.fn((_binary: string, _args: readonly string[], _env: NodeJS.ProcessEnv) => fake.child)
    const sidecar = new ComposerSidecar({ binary: '/bin/composer', environment: { PATH: '/bin', NEXUS_COMPOSER_HOME: '/tmp/stale' }, spawn })
    void sidecar.start().catch(() => undefined)
    const env = spawn.mock.calls[0]![2]
    expect(env).not.toHaveProperty('NEXUS_COMPOSER_HOME')
    expect(env.PATH).toBe('/bin')
    fake.exit(0)
  })

  it.each([
    ['stray stdout', 'not json'],
    ['a protocol mismatch', { ...READY, bridgeProtocol: 2 }],
    ['a non-loopback bridge', { ...READY, url: 'http://10.0.0.1:4321' }],
  ])('rejects %s and terminates the child', async (_case, frame) => {
    const f = setup()
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(frame)
    await expect(ready).rejects.toThrow()
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('rejects ready before authentication', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    f.frame(READY)
    await expect(ready).rejects.toThrow('unexpected ready')
  })

  it('reports an early exit with the stderr tail', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    f.stderr.write('requires NEXUS_COMPOSER_HOME')
    await flush()
    f.exit(2)
    await expect(ready).rejects.toThrow(/exited with 2: requires NEXUS_COMPOSER_HOME/)
  })

  it('reports a crash after ready through onFailure, and not during stop', async () => {
    const onFailure = vi.fn()
    const f = setup({ onFailure })
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(READY)
    await ready
    f.exit(101)
    expect((onFailure.mock.calls[0] as [Error])[0].message).toContain('exited with 101')

    const g = setup({ onFailure: vi.fn() })
    const second = g.sidecar.start()
    g.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    g.frame(READY)
    await second
    await g.sidecar.stop()
    expect(g.written.at(-1)).toBe('{"type":"shutdown"}')
    expect(g.child.kill).not.toHaveBeenCalled()
  })

  it('tracks ownership changes after ready and rejects them before', async () => {
    const onOwnership = vi.fn()
    const f = setup({ onOwnership })
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(READY)
    await ready
    f.frame({ type: 'ownership', ownership: 'external', reason: 'drift' })
    await flush()
    expect(onOwnership).toHaveBeenCalledWith('external', 'drift')
    expect(f.sidecar.ready?.ownership).toBe('external')

    const g = setup()
    const early = g.sidecar.start()
    g.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    g.frame({ type: 'ownership', ownership: 'external', reason: 'drift' })
    await expect(early).rejects.toThrow('before ready')
  })

  it('forwards invokes with the bearer secret and maps every envelope', async () => {
    const responses = [
      new Response(JSON.stringify({ ok: { p1: {} } }), { status: 200 }),
      new Response(JSON.stringify({ err: 'Provider not found: x' }), { status: 422 }),
      new Response(JSON.stringify({ schemaVersion: 1, error: { code: 'app_not_ready', retryable: true } }), { status: 503 }),
    ]
    const fetch = vi.fn(async () => responses.shift()!)
    const f = setup({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await f.sidecar.invoke('get_providers', {})).toEqual({ bridgeError: { code: 'app_not_ready', retryable: true } })
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(READY)
    await ready
    const secret = (JSON.parse(f.written[0]) as { secret: string }).secret
    expect(await f.sidecar.invoke('get_providers', { app: 'claude' })).toEqual({ ok: { p1: {} } })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4321/v1/invoke/get_providers')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${secret}`)
    expect(init.body).toBe('{"app":"claude"}')
    expect(await f.sidecar.invoke('get_providers', {})).toEqual({ err: 'Provider not found: x' })
    expect(await f.sidecar.invoke('get_providers', {})).toEqual({ bridgeError: { code: 'app_not_ready', retryable: true } })
    expect(await f.sidecar.invoke('../hello', {})).toEqual({ bridgeError: { code: 'unknown_command', retryable: false } })
    expect(await f.sidecar.invoke('get_providers', [1])).toEqual({ bridgeError: { code: 'invalid_arguments', retryable: false } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('correlates quit requests with their answers and fails them when the sidecar exits', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(READY)
    await ready

    const inspection = f.sidecar.inspectQuit()
    await flush()
    expect(JSON.parse(f.written.at(-1)!)).toEqual({ type: 'inspect-quit', id: 0 })
    f.frame({ type: 'quit-inspection', id: 0, routedClients: ['codex'] })
    await expect(inspection).resolves.toEqual(['codex'])

    const release = f.sidecar.release()
    f.frame({ type: 'awaiting-codex-decision', id: 1 })
    await expect(release).resolves.toEqual({ status: 'awaitingCodexDecision' })
    const decision = f.sidecar.codexDecision('resume')
    await flush()
    expect(JSON.parse(f.written.at(-1)!)).toEqual({ type: 'codex-decision', decision: 'resume', id: 2 })
    f.frame({ type: 'release-cancelled', id: 2 })
    await expect(decision).resolves.toEqual({ status: 'cancelled' })

    const failed = f.sidecar.release()
    f.frame({ type: 'release-failed', id: 3, error: 'vscode_release_failed:x' })
    await expect(failed).resolves.toEqual({ status: 'failed', error: 'vscode_release_failed:x' })

    const orphan = f.sidecar.release()
    f.exit(1)
    await expect(orphan).rejects.toThrow('exited with 1')
    await expect(f.sidecar.release()).rejects.toThrow('not running')
  })

  it('treats an answer to an unknown request as a protocol violation', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame(READY)
    await ready
    f.frame({ type: 'released', id: 99 })
    await flush()
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('restores client routing with --restore-and-exit and waits for the exit', async () => {
    const f = setup()
    const restored = f.sidecar.restore()
    expect(f.spawn.mock.calls[0]?.[1]).toEqual(['--sidecar', '--restore-and-exit'])
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame({ type: 'restored', ownership: 'owner', codexRestartRequired: true })
    await flush()
    f.exit(0)
    await expect(restored).resolves.toEqual({ ownership: 'owner', codexRestartRequired: true })
    expect(f.child.kill).not.toHaveBeenCalled()
    await expect(f.sidecar.restore()).rejects.toThrow(/already started/)
  })

  it('reports a failed restore', async () => {
    const onFailure = vi.fn()
    const f = setup({ onFailure })
    const restored = f.sidecar.restore()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame({ type: 'restore-failed', error: 'codex_release_failed: busy' })
    await expect(restored).rejects.toThrow(/codex_release_failed: busy/)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('rejects a restore result from a serving sidecar', async () => {
    const f = setup()
    const ready = f.sidecar.start()
    f.frame({ type: 'starting', version: '1.0.0' })
    await flush()
    f.frame({ type: 'restored', ownership: 'owner', codexRestartRequired: false })
    await expect(ready).rejects.toThrow(/unexpected restore result/)
  })
})
