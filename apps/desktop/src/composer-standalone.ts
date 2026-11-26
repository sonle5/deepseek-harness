/** Decides whether the standalone Nexus Composer another process runs may hand routing over. */

import type { ComposerExternalOwner } from './composer-sidecar.ts'

/**
 * Oldest standalone Composer release that takes the owner lock and hands routing over cleanly.
 *
 * This is the "handoff release": it writes the lock, and an older release that never takes the lock is
 * detected only through its proxy. Raise it together with the embedded Composer pin in
 * `apps/desktop/scripts/composer/lock.json` once a release publishes embedded artifacts.
 */
export const COMPOSER_MINIMUM_STANDALONE_VERSION = '3.16.7'

/** A numeric major.minor.patch triple, plus whether a prerelease suffix followed it. */
export interface ComposerVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: boolean
}

/**
 * Parse a plain semver version. A prerelease tag is kept only as a flag: it sorts before its release, which is
 * the conservative reading for a handoff check (an `-rc` build might not carry the handoff change).
 * @param value - Version text such as `3.16.7` or `3.16.7-rc.1`.
 * @returns the parsed version, or undefined when it is not semver.
 */
export function parseComposerVersion(value: string): ComposerVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim())
  if (match === null) return undefined
  const [, major, minor, patch, prerelease] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: prerelease !== undefined }
}

/**
 * Compare two versions by their numeric core; a prerelease sorts before its release.
 * @returns negative when `a` is older, zero when equal, positive when `a` is newer.
 */
export function compareComposerVersions(a: ComposerVersion, b: ComposerVersion): number {
  const core = (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch)
  if (core !== 0) return core
  return Number(b.prerelease) - Number(a.prerelease)
}

/** Whether `version` is at least the minimum standalone release. */
export function satisfiesComposerMinimum(version: string, minimum: string = COMPOSER_MINIMUM_STANDALONE_VERSION): boolean {
  const parsed = parseComposerVersion(version)
  const floor = parseComposerVersion(minimum)
  if (parsed === undefined || floor === undefined) return false
  return compareComposerVersions(parsed, floor) >= 0
}

/** What the detected standalone Composer means for the embedded one. */
export type ComposerStandaloneState =
  /** The standalone takes the lock and is new enough to hand routing over when it quits. */
  | 'handoff'
  /** The standalone cannot hand over cleanly: too old, predating the lock, or not naming its version. */
  | 'outdated'

/** Ready facts the classifier reads; undefined while no sidecar serves. */
export interface ComposerStandaloneFacts {
  readonly ownership: string
  readonly externalOwner?: ComposerExternalOwner | undefined
}

/**
 * Classify another Composer that owns routing.
 *
 * A proxy-only owner predates the lock, so it is always outdated. A lock holder is a handoff only when its
 * version is known and at least the minimum; a missing version is outdated because nothing proves the holder
 * can hand over.
 * @param facts - The sidecar's ready facts, or undefined while none serves.
 * @param minimum - Minimum standalone version; tests pass a fixture.
 * @returns `undefined` when this process owns routing (no notice), else the standalone state.
 */
export function classifyComposerStandalone(
  facts: ComposerStandaloneFacts | undefined,
  minimum: string = COMPOSER_MINIMUM_STANDALONE_VERSION,
): ComposerStandaloneState | undefined {
  if (facts === undefined || facts.ownership !== 'external') return undefined
  const { externalOwner } = facts
  if (externalOwner?.detectedBy !== 'lock') return 'outdated'
  return externalOwner.version !== undefined && satisfiesComposerMinimum(externalOwner.version, minimum)
    ? 'handoff'
    : 'outdated'
}
