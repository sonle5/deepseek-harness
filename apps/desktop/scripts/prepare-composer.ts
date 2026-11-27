/** Stage the pinned, digest-verified Nexus Composer sidecar and renderer for one Desktop target. */

import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { x as extractTar } from 'tar'
import { COMPOSER_BRIDGE_PROTOCOL } from '../src/composer-sidecar.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import lockFile from './composer/lock.json' with { type: 'json' }

/** Node `${platform}-${arch}` keys the Composer artifact contract names. */
export const COMPOSER_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64'] as const
export type ComposerTarget = typeof COMPOSER_TARGETS[number]

/** Composer artifact each Desktop release target embeds. */
export const DESKTOP_COMPOSER_TARGETS = {
  'mac-arm64': 'darwin-arm64',
  'mac-x64': 'darwin-x64',
  'win-x64': 'win32-x64',
} as const satisfies Record<ReturnType<typeof resolveDesktopBuildTarget>, ComposerTarget>

/** Targets no Composer release builds; the lock must keep them unavailable. */
const UNSUPPORTED_TARGETS: ReadonlySet<ComposerTarget> = new Set(['win32-arm64', 'linux-x64'])

/** Validated `scripts/composer/lock.json`. A release without any available target pins no version. */
export type ComposerLock = {
  readonly repository: string
  readonly tag: string
  readonly targets: Readonly<Record<ComposerTarget, { readonly available: false } | { readonly available: true; readonly sha256: string }>>
} & ({ readonly version: null } | {
  readonly version: string
  readonly commit: string
  readonly bridgeProtocol: number
  readonly schemaVersion: number
  readonly rendererSha256: string
})

/** Facts the packaged shell reads from `resources/composer/manifest.json`. */
export interface StagedComposerManifest {
  readonly version: string
  readonly commit: string
  readonly bridgeProtocol: number
  readonly schemaVersion: number
  readonly target: ComposerTarget
}

/**
 * Environment variable holding a token that can read the lock's release repository.
 * Packaging passes it to the `prepare:composer` stage only, never to the other build stages.
 */
export const COMPOSER_TOKEN_ENV = 'DSH_DESKTOP_COMPOSER_TOKEN'

const SHA256 = /^[0-9a-f]{64}$/u
const COMMIT = /^[0-9a-f]{40}$/u
/** A tag segment that names a commit, such as `4bbac2b7` in `composer-{version}-4bbac2b7`. */
const TAG_COMMIT = /(?:^|[-_/])([0-9a-f]{7,40})(?=$|[-_/])/gu
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`composer: ${label} must be an object`)
  return value as Record<string, unknown>
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`composer: ${label} must be a positive integer`)
  return value as number
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`composer: ${label} is invalid`)
  return value
}

/**
 * Validate the lock shape; an unpinned lock (version null) must leave every target unavailable.
 * @param value - Parsed lock JSON.
 * @returns Validated lock.
 */
export function parseComposerLock(value: unknown): ComposerLock {
  const lock = record(value, 'lock')
  const release = record(lock.release, 'lock release')
  if (typeof release.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(release.repository)) throw new Error('composer: lock release repository is invalid')
  if (typeof release.tag !== 'string' || !release.tag.includes('{version}')) throw new Error('composer: lock release tag must contain {version}')
  const targetRecords = record(lock.targets, 'lock targets')
  for (const key of Object.keys(targetRecords)) {
    if (!(COMPOSER_TARGETS as readonly string[]).includes(key)) throw new Error(`composer: lock names unknown target ${key}`)
  }
  const targets = Object.fromEntries(COMPOSER_TARGETS.map((target) => {
    const entry = record(targetRecords[target], `lock target ${target}`)
    if (entry.available === false) {
      if ('sha256' in entry) throw new Error(`composer: unavailable target ${target} must not pin a digest`)
      return [target, { available: false }]
    }
    if (entry.available !== true) throw new Error(`composer: lock target ${target} needs a boolean available`)
    if (UNSUPPORTED_TARGETS.has(target)) throw new Error(`composer: no Composer release builds ${target}`)
    return [target, { available: true, sha256: matching(entry.sha256, SHA256, `lock target ${target} sha256`) }]
  })) as ComposerLock['targets']
  const base = { repository: release.repository, tag: release.tag, targets }
  if (lock.version === null) {
    if (Object.values(targets).some(target => target.available)) throw new Error('composer: a lock without a version cannot make targets available')
    for (const key of ['commit', 'bridgeProtocol', 'schemaVersion', 'renderer'] as const) {
      if (lock[key] !== null) throw new Error(`composer: a lock without a version must leave ${key} null`)
    }
    return { ...base, version: null }
  }
  const renderer = record(lock.renderer, 'lock renderer')
  const commit = matching(lock.commit, COMMIT, 'lock commit')
  // A tag that names a commit must name the pinned one, so bumping `commit` without the tag fails here.
  for (const [, prefix] of release.tag.replaceAll('{version}', '').matchAll(TAG_COMMIT)) {
    if (!commit.startsWith(prefix!)) throw new Error(`composer: lock release tag names commit ${prefix!}, but the lock pins ${commit}`)
  }
  return {
    ...base,
    version: matching(lock.version, VERSION, 'lock version'),
    commit,
    bridgeProtocol: integer(lock.bridgeProtocol, 'lock bridgeProtocol'),
    schemaVersion: integer(lock.schemaVersion, 'lock schemaVersion'),
    rendererSha256: matching(renderer.sha256, SHA256, 'lock renderer sha256'),
  }
}

/** Reads one release file by its contract name. */
export type ComposerArtifactSource = (file: string, sha256?: string) => Promise<Buffer>

/**
 * Read release files from a directory holding the contract's files side by side.
 * @param directory - Absolute artifacts directory.
 */
export function localComposerArtifacts(directory: string): ComposerArtifactSource {
  if (!isAbsolute(directory)) throw new Error('composer: the artifacts directory must be an absolute path')
  return async file => readFileSync(join(directory, file))
}

/**
 * Download release files, reusing verified binaries from the shared download cache.
 * Without a token the public release download URL is used; with one, the REST asset endpoint, which also serves private repositories.
 * @param lock - Pinned release.
 * @param version - Pinned version.
 * @param cache - Shared download cache directory.
 * @param environment - Optional {@link COMPOSER_TOKEN_ENV} and download timeout.
 * @param fetcher - Network implementation; tests replace it.
 */
export function releaseComposerArtifacts(lock: ComposerLock, version: string, cache: string, environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch): ComposerArtifactSource {
  const tag = lock.tag.replaceAll('{version}', version)
  const token = environment[COMPOSER_TOKEN_ENV]
  const timeout = Number(environment.DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS ?? '300000')
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS must be an integer from 1 to 2147483647')
  let assets: Promise<Map<string, string>> | undefined
  const request = async (url: string, accept: string): Promise<Response> => {
    const headers: Record<string, string> = { accept, 'user-agent': 'dsh-desktop-packaging' }
    if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`composer download: ${String(response.status)} ${url}`)
    return response
  }
  const assetUrl = async (file: string): Promise<string> => {
    if (token === undefined || token === '') return `https://github.com/${lock.repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`
    assets ??= request(`https://api.github.com/repos/${lock.repository}/releases/tags/${encodeURIComponent(tag)}`, 'application/vnd.github+json')
      .then(async (response) => {
        const body = record(await response.json(), 'release')
        const list = Array.isArray(body.assets) ? body.assets as unknown[] : []
        return new Map(list.map(asset => record(asset, 'release asset')).filter(asset => typeof asset.name === 'string' && typeof asset.url === 'string')
          .map(asset => [asset.name as string, asset.url as string]))
      })
    const url = (await assets).get(file)
    if (url === undefined) throw new Error(`composer download: release ${tag} has no asset ${file}`)
    return url
  }
  return async (file, sha256) => {
    const cached = sha256 === undefined ? undefined : join(cache, sha256)
    if (cached !== undefined && existsSync(cached)) return readFileSync(cached)
    const url = await assetUrl(file)
    const bytes = Buffer.from(await (await request(url, token === undefined || token === '' ? '*/*' : 'application/octet-stream')).arrayBuffer())
    if (cached !== undefined && digest(bytes) === sha256) {
      mkdirSync(cache, { recursive: true })
      const temporary = join(cache, `.${randomUUID()}`)
      try {
        writeFileSync(temporary, bytes)
        renameSync(temporary, cached)
      } finally { rmSync(temporary, { force: true }) }
    }
    return bytes
  }
}

/**
 * Fail in seconds, before any long packaging stage, when the pinned release cannot be read.
 * Skipped when the target ships without Composer or when local artifacts replace the download.
 * @param desktopTarget - Desktop release target.
 * @param environment - Packaging environment; reads {@link COMPOSER_TOKEN_ENV} and `DSH_DESKTOP_COMPOSER_ARTIFACTS`.
 * @param lock - Pinned release; defaults to the checked-in lock.
 * @param fetcher - Network implementation; tests replace it.
 * @returns The release tag that was confirmed, or undefined when nothing needs downloading.
 */
export async function checkComposerReleaseAccess(desktopTarget: keyof typeof DESKTOP_COMPOSER_TARGETS, environment: NodeJS.ProcessEnv,
  lock: ComposerLock = parseComposerLock(lockFile), fetcher: typeof fetch = fetch): Promise<string | undefined> {
  if (lock.version === null || !lock.targets[DESKTOP_COMPOSER_TARGETS[desktopTarget]].available) return undefined
  const artifacts = environment.DSH_DESKTOP_COMPOSER_ARTIFACTS
  if (artifacts !== undefined && artifacts !== '') return undefined
  const tag = lock.tag.replaceAll('{version}', lock.version)
  const token = environment[COMPOSER_TOKEN_ENV]
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-desktop-packaging' }
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
  const url = `https://api.github.com/repos/${lock.repository}/releases/tags/${encodeURIComponent(tag)}`
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (response.ok) return tag
  const hint = token === undefined || token === ''
    ? `set ${COMPOSER_TOKEN_ENV} to a token that can read ${lock.repository}`
    : `${COMPOSER_TOKEN_ENV} cannot read it; it may be expired or lack access to ${lock.repository}`
  throw new Error(`composer: release ${tag} in ${lock.repository} is not readable (${String(response.status)}); ${hint}`)
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function verified(bytes: Buffer, sha256: string, file: string): Buffer {
  if (digest(bytes) !== sha256) throw new Error(`composer: checksum mismatch for ${file}`)
  return bytes
}

/** A contract file name: one path segment, never a traversal. */
function releaseFile(value: unknown, expected: string, label: string): string {
  if (value !== expected || basename(expected) !== expected) throw new Error(`composer: manifest ${label} must be ${expected}`)
  return expected
}

/**
 * Check the release manifest against the lock and return the files to stage.
 * @param value - Parsed `nexus-composer-embedded-manifest-<version>.json`.
 * @param lock - Pinned release with a version.
 * @param target - Selected available target.
 * @returns Renderer and sidecar file names.
 */
export function verifyComposerManifest(value: unknown, lock: Extract<ComposerLock, { version: string }>,
  target: ComposerTarget): { renderer: string; binary: string } {
  const manifest = record(value, 'manifest')
  if (manifest.manifestVersion !== 1) throw new Error('composer: manifest manifestVersion must be 1')
  if (manifest.name !== 'nexus-composer') throw new Error('composer: manifest name must be nexus-composer')
  for (const key of ['version', 'commit', 'bridgeProtocol', 'schemaVersion'] as const) {
    if (manifest[key] !== lock[key]) throw new Error(`composer: manifest ${key} ${JSON.stringify(manifest[key])} does not match the lock (${JSON.stringify(lock[key])})`)
  }
  const renderer = record(manifest.renderer, 'manifest renderer')
  if (renderer.sha256 !== lock.rendererSha256) throw new Error('composer: manifest renderer sha256 does not match the lock')
  const pinned = lock.targets[target]
  if (!pinned.available) throw new Error(`composer: ${target} is not available in the lock`)
  const entry = record(record(manifest.targets, 'manifest targets')[target], `manifest target ${target}`)
  if (entry.sha256 !== pinned.sha256) throw new Error(`composer: manifest ${target} sha256 does not match the lock`)
  return {
    renderer: releaseFile(renderer.file, `nexus-composer-renderer-${lock.version}.tar.gz`, 'renderer file'),
    binary: releaseFile(entry.file, `nexus-composer-sidecar-${lock.version}-${target}${target.startsWith('win32-') ? '.exe' : ''}`, `${target} file`),
  }
}

/** Options for {@link prepareComposer}. */
export interface PrepareComposerOptions {
  /** Composer artifact target. */
  readonly target: ComposerTarget
  /** Staged directory; replaced on success, removed when the target is unavailable. */
  readonly output: string
  readonly lock: ComposerLock
  /** Release file reader; defaults to downloads by the lock's release. */
  readonly source: (version: string) => ComposerArtifactSource
  readonly log?: (message: string) => void
}

/**
 * Stage `bin/nexus-composer[.exe]`, `dist/` and `manifest.json`, or nothing for an unavailable target.
 * @returns Staged facts, or undefined when Composer is skipped.
 */
export async function prepareComposer(options: PrepareComposerOptions): Promise<StagedComposerManifest | undefined> {
  const { lock, target, output } = options
  const log = options.log ?? ((message) => { console.log(message) })
  rmSync(output, { recursive: true, force: true })
  const pinned = lock.targets[target]
  if (lock.version === null || !pinned.available) {
    log(`composer: no pinned Composer artifact for ${target}; packaging without Composer`)
    return undefined
  }
  if (lock.bridgeProtocol !== COMPOSER_BRIDGE_PROTOCOL) {
    throw new Error(`composer: the lock pins bridge protocol ${String(lock.bridgeProtocol)}, but this shell speaks ${String(COMPOSER_BRIDGE_PROTOCOL)}`)
  }
  const source = options.source(lock.version)
  const manifestFile = `nexus-composer-embedded-manifest-${lock.version}.json`
  let manifest: unknown
  try { manifest = JSON.parse((await source(manifestFile)).toString('utf8')) } catch (error) {
    throw new Error(`composer: cannot read ${manifestFile}`, { cause: error })
  }
  const files = verifyComposerManifest(manifest, lock, target)
  const renderer = verified(await source(files.renderer, lock.rendererSha256), lock.rendererSha256, files.renderer)
  const binary = verified(await source(files.binary, pinned.sha256), pinned.sha256, files.binary)
  const staging = join(dirname(output), `.composer-${randomUUID()}`)
  try {
    const dist = join(staging, 'dist')
    mkdirSync(dist, { recursive: true })
    const archive = join(staging, 'renderer.tar.gz')
    writeFileSync(archive, renderer)
    const rejected: string[] = []
    // The renderer holds plain files and directories only; tar already refuses absolute and parent paths.
    await extractTar({
      file: archive, cwd: dist, strict: true,
      filter: (path, entry) => {
        const type = 'type' in entry ? entry.type : undefined
        if (type === 'File' || type === 'Directory') return true
        rejected.push(path)
        return false
      },
    })
    rmSync(archive)
    if (rejected.length > 0) throw new Error(`composer: renderer archive holds non-regular entries: ${rejected.join(', ')}`)
    const index = join(dist, 'index.html')
    if (!existsSync(index) || !statSync(index).isFile()) throw new Error('composer: renderer archive has no index.html at its root')
    const bin = join(staging, 'bin')
    mkdirSync(bin)
    const executable = join(bin, target.startsWith('win32-') ? 'nexus-composer.exe' : 'nexus-composer')
    writeFileSync(executable, binary)
    chmodSync(executable, 0o755)
    const staged: StagedComposerManifest = {
      version: lock.version, commit: lock.commit, bridgeProtocol: lock.bridgeProtocol, schemaVersion: lock.schemaVersion, target,
    }
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(staged, undefined, 2)}\n`)
    renameSync(staging, output)
    log(`composer: staged Nexus Composer ${lock.version} (${target}) at ${output}`)
    return staged
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { from: { type: 'string' } } })
  const desktopTarget = resolveDesktopBuildTarget()
  const paths = resolveDesktopTargetBuildPaths()
  const lock = parseComposerLock(lockFile)
  const from = values.from ?? process.env.DSH_DESKTOP_COMPOSER_ARTIFACTS
  await prepareComposer({
    target: DESKTOP_COMPOSER_TARGETS[desktopTarget],
    output: paths.composer,
    lock,
    source: version => from !== undefined && from !== ''
      ? localComposerArtifacts(resolve(from))
      : releaseComposerArtifacts(lock, version, join(paths.downloads, 'composer')),
  })
}

if (import.meta.main) await main()
