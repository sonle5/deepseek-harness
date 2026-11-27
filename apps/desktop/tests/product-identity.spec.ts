import { describe, expect, it } from 'vitest'
import { PRODUCT_IDENTITY } from '../product-identity.mjs'
import { brandArtwork, dmgArtwork } from '../scripts/render-brand-assets.ts'

/** Text content of every `<text>` element in an SVG document. */
function svgText(svg: Buffer): string[] {
  return [...svg.toString('utf8').matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map(match => match[1]!)
}

describe('product identity', () => {
  it('names only the product and its publisher in the copyright', () => {
    expect(PRODUCT_IDENTITY.copyright).toBe('Copyright © 2026 One Nexus')
  })

  it('carries no upstream name in any user-visible identity field', () => {
    // The legacy user-data directory is a filesystem path kept for existing installs, never displayed.
    const { legacyUserDataDirectory: _legacy, ...visible } = PRODUCT_IDENTITY
    for (const [field, value] of Object.entries(visible)) {
      if (typeof value === 'string') expect(value, field).not.toMatch(/deepseek/iu)
    }
  })

  it.each([
    ['DMG background', dmgArtwork()],
    ['installer banner', brandArtwork(600, 196, false)],
    ['dark installer banner', brandArtwork(600, 196, true)],
    ['uninstaller sidebar', brandArtwork(164, 314, false, true)],
  ])('keeps the upstream name out of the %s', (_name, svg) => {
    const text = svgText(svg)
    expect(text.length).toBeGreaterThan(0)
    for (const line of text) expect(line).not.toMatch(/deepseek/iu)
    expect(text.some(line => /ONE NEXUS/u.test(line))).toBe(true)
  })
})
