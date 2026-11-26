/** The brand font remains self-contained in the packaged Web application. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('offline brand font', () => {
  it('ships both local Nexus Composer font families with their redistribution licenses', () => {
    const css = readFileSync(new URL('../src/styles/brand-font.css', import.meta.url), 'utf8')
    const fontPaths = [...css.matchAll(/url\(\.\/([^)]*\.woff2)\)/gu)].map(match => match[1]!)
    expect(fontPaths).toHaveLength(12)
    for (const fontPath of fontPaths) {
      expect(readFileSync(new URL(`../src/styles/${fontPath}`, import.meta.url)).readUInt32BE(0)).toBe(0x774f4632)
    }
    expect(css).toContain("font-family: 'Space Grotesk'")
    expect(css).toContain("font-family: 'IBM Plex Serif'")
    expect(css).toContain('font-weight: 400')
    expect(css).toContain('font-weight: 300 700')
    expect(css).toContain('font-weight: 600')
    expect(css).toContain('font-style: normal')
    expect(css).not.toMatch(/url\(https?:/)
    for (const licenseFile of ['Space-Grotesk-OFL.txt', 'IBM-Plex-Serif-OFL.txt']) {
      expect(readFileSync(new URL(`../src/styles/${licenseFile}`, import.meta.url), 'utf8'))
        .toContain('SIL OPEN FONT LICENSE Version 1.1')
    }
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      files: string[]
      exports: Record<string, unknown>
    }
    expect(manifest.files).toContain('lib/styles')
    expect(manifest.exports['./brand-font.css']).toBe('./lib/styles/brand-font.css')

    const build = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8')
    expect(build).toContain('space-grotesk-*.woff2')
    expect(build).toContain('ibm-plex-serif-*.woff2')
    expect(build).toContain('Space-Grotesk-OFL.txt')
    expect(build).toContain('IBM-Plex-Serif-OFL.txt')
    expect(build).not.toContain('montserrat-')
  })

  it('uses the Composer semibold hierarchy for document headings', () => {
    const css = readFileSync(new URL('../src/styles/gradient-shadow-text.css', import.meta.url), 'utf8')
    for (const level of [1, 2, 3]) {
      expect(css).toContain(`--dsw-font-markdown-h${String(level)}: 600`)
      expect(css).toContain(`--dsw-font-markdown-h${String(level)}-font-weight: 600`)
    }
  })
})
