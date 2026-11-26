import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import lockFile from '../scripts/composer/lock.json' with { type: 'json' }
import {
  COMPOSER_TARGETS, localComposerArtifacts, parseComposerLock, prepareComposer, releaseComposerArtifacts,
  type ComposerLock, type ComposerTarget,
} from '../scripts/prepare-composer.ts'

vi.mock('electron', () => ({ WebContentsView: vi.fn(), session: {}, shell: { openExternal: vi.fn() } }))
const { packagedComposerResources } = await import('../src/composer-view.ts')

const VERSION = '3.30.0'
const COMMIT = 'a'.repeat(40)
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-prepare-composer-'))
  roots.push(root)
  return root
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Release directory laid out exactly as the artifact contract names its files. */
async function release(target: ComposerTarget, overrides: { manifest?: Record<string, unknown>; index?: boolean } = {}) {
  const root = temporary()
  const artifacts = join(root, 'artifacts')
  const renderer = join(root, 'renderer')
  mkdirSync(join(renderer, 'assets'), { recursive: true })
  mkdirSync(artifacts)
  if (overrides.index !== false) writeFileSync(join(renderer, 'index.html'), '<html></html>')
  writeFileSync(join(renderer, 'assets', 'entry.js'), 'globalThis.composer = true')
  const rendererFile = `nexus-composer-renderer-${VERSION}.tar.gz`
  await createTar({ gzip: true, cwd: renderer, file: join(artifacts, rendererFile), portable: true }, ['.'])
  const binaryFile = `nexus-composer-sidecar-${VERSION}-${target}${target.startsWith('win32-') ? '.exe' : ''}`
  const binary = Buffer.from(`composer sidecar for ${target}`)
  writeFileSync(join(artifacts, binaryFile), binary)
  const rendererSha256 = sha256(readFileSync(join(artifacts, rendererFile)))
  const binarySha256 = sha256(binary)
  const manifest = {
    manifestVersion: 1, name: 'nexus-composer', version: VERSION, commit: COMMIT, bridgeProtocol: 1, schemaVersion: 7, features: {},
    renderer: { file: rendererFile, sha256: rendererSha256 },
    targets: { [target]: { rustTarget: 'fixture', file: binaryFile, sha256: binarySha256 } },
    ...overrides.manifest,
  }
  writeFileSync(join(artifacts, `nexus-composer-embedded-manifest-${VERSION}.json`), JSON.stringify(manifest))
  const lock = parseComposerLock({
    release: { repository: 'onenexus-team/nexus-composer', tag: 'v{version}' },
    version: VERSION, commit: COMMIT, bridgeProtocol: 1, schemaVersion: 7, renderer: { sha256: rendererSha256 },
    targets: Object.fromEntries(COMPOSER_TARGETS.map(key => [key,
      key === target ? { available: true, sha256: binarySha256 } : { available: false }])),
  })
  return { root, artifacts, lock, binary, binarySha256 }
}

function stage(lock: ComposerLock, target: ComposerTarget, artifacts: string, output: string) {
  return prepareComposer({ target, output, lock, source: () => localComposerArtifacts(artifacts), log: () => undefined })
}

/** The checked-in lock's shape before any release exists: no version, no digest, no target. */
const unpinnedLock = {
  release: lockFile.release,
  version: null,
  commit: null,
  bridgeProtocol: null,
  schemaVersion: null,
  renderer: null,
  targets: Object.fromEntries(COMPOSER_TARGETS.map(target => [target, { available: false }])),
}

describe('composer lock', () => {
  it('pins a release this shell can embed', () => {
    const lock = parseComposerLock(lockFile)
    expect(lock.version).not.toBeNull()
    // The pinned variant carries these; the unpinned one does not.
    if (lock.version === null) throw new Error('the checked-in lock must pin a release')
    expect(lock.bridgeProtocol).toBe(1)
    expect(lock.schemaVersion).toBeGreaterThanOrEqual(32)
    expect(Object.keys(lock.targets).sort()).toEqual([...COMPOSER_TARGETS].sort())
    expect(lock.targets['darwin-arm64'].available).toBe(true)
  })

  it('pins no release and leaves every target unavailable', () => {
    const lock = parseComposerLock(unpinnedLock)
    expect(lock.version).toBeNull()
    expect(Object.keys(lock.targets).sort()).toEqual([...COMPOSER_TARGETS].sort())
    for (const target of COMPOSER_TARGETS) expect(lock.targets[target].available).toBe(false)
  })

  it.each([
    ['an available target without a version', { targets: { ...unpinnedLock.targets, 'darwin-arm64': { available: true, sha256: 'a'.repeat(64) } } }],
    ['an unpinned field without a version', { commit: COMMIT }],
    ['a missing target', { targets: { 'darwin-arm64': { available: false } } }],
    ['an unknown target', { targets: { ...unpinnedLock.targets, 'linux-arm64': { available: false } } }],
  ])('rejects %s', (_case, change) => {
    expect(() => parseComposerLock({ ...unpinnedLock, ...change })).toThrow(/composer:/u)
  })

  it.each(['win32-arm64', 'linux-x64'] as const)('keeps %s unavailable', async (target) => {
    const { lock } = await release('darwin-arm64')
    expect(() => parseComposerLock({
      release: { repository: lock.repository, tag: lock.tag }, version: VERSION, commit: COMMIT, bridgeProtocol: 1, schemaVersion: 7,
      renderer: { sha256: 'b'.repeat(64) },
      targets: Object.fromEntries(COMPOSER_TARGETS.map(key => [key, key === target ? { available: true, sha256: 'c'.repeat(64) } : { available: false }])),
    })).toThrow(`no Composer release builds ${target}`)
  })
})

describe('prepare composer', () => {
  it('skips an unavailable target and removes a stale staged Composer', async () => {
    const output = join(temporary(), 'composer')
    mkdirSync(join(output, 'bin'), { recursive: true })
    const source = vi.fn()
    const log = vi.fn()
    await expect(prepareComposer({ target: 'darwin-arm64', output, lock: parseComposerLock(unpinnedLock), source, log })).resolves.toBeUndefined()
    expect(existsSync(output)).toBe(false)
    expect(source).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('packaging without Composer'))
  })

  it('skips a target the pinned lock does not publish', async () => {
    const output = join(temporary(), 'composer')
    const lock = parseComposerLock(lockFile)
    // The pin publishes only darwin-arm64 at this commit, so every other target stages nothing.
    const unpublished = COMPOSER_TARGETS.find(target => target !== 'darwin-arm64' && !lock.targets[target].available)
    if (unpublished === undefined) return
    const source = vi.fn()
    await expect(prepareComposer({ target: unpublished, output, lock, source, log: () => undefined })).resolves.toBeUndefined()
    expect(source).not.toHaveBeenCalled()
  })

  it.each(['darwin-arm64', 'win32-x64'] as const)('stages the %s sidecar, renderer and manifest the packaged shell resolves', async (target) => {
    const { root, artifacts, lock, binary } = await release(target)
    const resources = join(root, 'resources')
    const output = join(resources, 'composer')
    const staged = await stage(lock, target, artifacts, output)
    expect(staged).toEqual({ version: VERSION, commit: COMMIT, bridgeProtocol: 1, schemaVersion: 7, target })
    const executable = join(output, 'bin', target === 'win32-x64' ? 'nexus-composer.exe' : 'nexus-composer')
    expect(readFileSync(executable)).toEqual(binary)
    if (process.platform !== 'win32') expect(statSync(executable).mode & 0o111).toBe(0o111)
    expect(readFileSync(join(output, 'dist', 'index.html'), 'utf8')).toBe('<html></html>')
    expect(existsSync(join(output, 'dist', 'assets', 'entry.js'))).toBe(true)
    expect(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))).toEqual(staged)
    if ((process.platform === 'win32') === target.startsWith('win32-')) {
      expect(packagedComposerResources(resources)).toEqual({ dist: join(output, 'dist'), binary: executable })
    }
  })

  it('fails on a sidecar digest mismatch and leaves nothing staged', async () => {
    const { artifacts, lock, root } = await release('darwin-arm64')
    writeFileSync(join(artifacts, `nexus-composer-sidecar-${VERSION}-darwin-arm64`), 'tampered')
    const output = join(root, 'composer')
    await expect(stage(lock, 'darwin-arm64', artifacts, output)).rejects.toThrow(`checksum mismatch for nexus-composer-sidecar-${VERSION}-darwin-arm64`)
    expect(existsSync(output)).toBe(false)
  })

  it('fails when the manifest pins a digest the lock does not', async () => {
    const { artifacts, lock, root } = await release('darwin-x64', { manifest: { renderer: { file: `nexus-composer-renderer-${VERSION}.tar.gz`, sha256: 'd'.repeat(64) } } })
    await expect(stage(lock, 'darwin-x64', artifacts, join(root, 'composer'))).rejects.toThrow('manifest renderer sha256 does not match the lock')
  })

  it.each([
    ['bridgeProtocol', 2],
    ['version', '3.30.1'],
    ['commit', 'b'.repeat(40)],
    ['schemaVersion', 8],
  ])('fails when the manifest %s disagrees with the lock', async (key, value) => {
    const { artifacts, lock, root } = await release('darwin-arm64', { manifest: { [key]: value } })
    await expect(stage(lock, 'darwin-arm64', artifacts, join(root, 'composer'))).rejects.toThrow(`manifest ${key} ${JSON.stringify(value)} does not match the lock`)
  })

  it('refuses a lock whose bridge protocol this shell does not speak', async () => {
    const { artifacts, lock, root } = await release('darwin-arm64')
    if (lock.version === null) throw new Error('fixture lock must pin a version')
    await expect(stage({ ...lock, bridgeProtocol: 2 }, 'darwin-arm64', artifacts, join(root, 'composer')))
      .rejects.toThrow('the lock pins bridge protocol 2')
  })

  it('requires index.html at the renderer root', async () => {
    const { artifacts, lock, root } = await release('darwin-arm64', { index: false })
    const output = join(root, 'composer')
    await expect(stage(lock, 'darwin-arm64', artifacts, output)).rejects.toThrow('no index.html at its root')
    expect(existsSync(output)).toBe(false)
  })

  it('reports no packaged Composer without a staged binary and renderer', () => {
    const resources = temporary()
    expect(packagedComposerResources(resources)).toBeUndefined()
    mkdirSync(join(resources, 'composer', 'dist'), { recursive: true })
    writeFileSync(join(resources, 'composer', 'dist', 'index.html'), '')
    expect(packagedComposerResources(resources)).toBeUndefined()
  })
})

describe('composer release downloads', () => {
  it('downloads by tag with a bearer token and caches verified files by digest', async () => {
    const { lock, binary, binarySha256 } = await release('darwin-arm64')
    const cache = join(temporary(), 'cache')
    // Declared with the fetcher signature the source injects, so the mock is
    // assignable without an assertion and its call arguments are typed.
    // The injected fetcher takes `RequestInfo | URL`, so the branch reads the
    // URL as a string only after narrowing to the form this test asserts on.
    const fetcher = vi.fn<typeof fetch>(async (url, _init) => typeof url === 'string' && url.includes('/releases/tags/')
      ? Response.json({ assets: [{ name: `nexus-composer-sidecar-${VERSION}-darwin-arm64`, url: 'https://api.github.com/assets/1' }] })
      : new Response(binary))
    const source = releaseComposerArtifacts(lock, VERSION, cache, { GITHUB_TOKEN: 'fixture-token' }, fetcher)
    await expect(source(`nexus-composer-sidecar-${VERSION}-darwin-arm64`, binarySha256)).resolves.toEqual(binary)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.github.com/repos/onenexus-team/nexus-composer/releases/tags/v${VERSION}`, 'https://api.github.com/assets/1',
    ])
    const init = fetcher.mock.calls[1]![1] ?? {}
    expect(init.headers).toMatchObject({ authorization: 'Bearer fixture-token', accept: 'application/octet-stream' })
    expect(readFileSync(join(cache, binarySha256))).toEqual(binary)
    await source(`nexus-composer-sidecar-${VERSION}-darwin-arm64`, binarySha256)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses the public download URL without a token', async () => {
    const { lock } = await release('darwin-arm64')
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    const source = releaseComposerArtifacts(lock, VERSION, join(temporary(), 'cache'), {}, fetcher)
    await source(`nexus-composer-embedded-manifest-${VERSION}.json`)
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://github.com/onenexus-team/nexus-composer/releases/download/v${VERSION}/nexus-composer-embedded-manifest-${VERSION}.json`)
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization')
  })
})
