import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MINIMUM_STANDALONE_VERSION, classifyComposerStandalone, compareComposerVersions,
  parseComposerVersion, satisfiesComposerMinimum,
} from '../src/composer-standalone.ts'

describe('composer standalone classification', () => {
  it('pins the handoff release as the minimum', () => {
    expect(COMPOSER_MINIMUM_STANDALONE_VERSION).toBe('3.16.7')
  })

  it.each([
    ['3.16.7', { major: 3, minor: 16, patch: 7, prerelease: false }],
    [' 3.16.7 ', { major: 3, minor: 16, patch: 7, prerelease: false }],
    ['3.16.7-rc.1', { major: 3, minor: 16, patch: 7, prerelease: true }],
    ['3.16.7+build.5', { major: 3, minor: 16, patch: 7, prerelease: false }],
  ])('parses %s', (value, parsed) => {
    expect(parseComposerVersion(value)).toEqual(parsed)
  })

  it.each(['', '3.16', 'v3.16.7', '3.16.x', '3.16.7.1', 'latest'])('rejects %j', (value) => {
    expect(parseComposerVersion(value)).toBeUndefined()
  })

  it('compares numeric cores and sorts a prerelease before its release', () => {
    const a = parseComposerVersion('3.16.7')!
    expect(compareComposerVersions(a, parseComposerVersion('3.16.7')!)).toBe(0)
    expect(compareComposerVersions(parseComposerVersion('3.17.0')!, a)).toBeGreaterThan(0)
    expect(compareComposerVersions(parseComposerVersion('3.9.9')!, a)).toBeLessThan(0)
    expect(compareComposerVersions(parseComposerVersion('3.16.7-rc.1')!, a)).toBeLessThan(0)
    expect(compareComposerVersions(a, parseComposerVersion('3.16.7-rc.1')!)).toBeGreaterThan(0)
  })

  it('satisfies the minimum only for a known, new-enough release', () => {
    expect(satisfiesComposerMinimum('3.16.7')).toBe(true)
    expect(satisfiesComposerMinimum('3.17.0')).toBe(true)
    expect(satisfiesComposerMinimum('3.16.6')).toBe(false)
    expect(satisfiesComposerMinimum('3.16.7-rc.1')).toBe(false)
    expect(satisfiesComposerMinimum('not-a-version')).toBe(false)
    expect(satisfiesComposerMinimum('2.0.0', '2.0.0')).toBe(true)
  })

  it('reports nothing while this process owns routing or no sidecar serves', () => {
    expect(classifyComposerStandalone(undefined)).toBeUndefined()
    expect(classifyComposerStandalone({ ownership: 'owner' })).toBeUndefined()
    expect(classifyComposerStandalone({ ownership: 'isolated' })).toBeUndefined()
    // An external owner without the additive object cannot be trusted to hand over.
    expect(classifyComposerStandalone({ ownership: 'external' })).toBe('outdated')
  })

  it('treats a new-enough lock holder as a handoff', () => {
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'lock', version: '3.16.7' },
    })).toBe('handoff')
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'lock', version: '4.0.0' },
    })).toBe('handoff')
  })

  it('treats an old, versionless, or proxy-only owner as outdated', () => {
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'lock', version: '3.0.0' },
    })).toBe('outdated')
    // A release that wrote only a pid cannot prove it hands over.
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'lock' },
    })).toBe('outdated')
    // A proxy-only owner predates the lock.
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'proxy' },
    })).toBe('outdated')
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'proxy', version: '9.9.9' },
    })).toBe('outdated')
  })

  it('honours a fixture minimum', () => {
    expect(classifyComposerStandalone({
      ownership: 'external', externalOwner: { detectedBy: 'lock', version: '2.0.0' },
    }, '2.0.0')).toBe('handoff')
  })
})
