/** Committed install icon dimensions and the generator's safe-zone scale. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_VARIANTS, ICON_OUTPUT_DIRECTORY, MASKABLE_ARTWORK_SCALE, TILE_SOURCE,
  maskableDocument, tileDocument,
} from '../scripts/render-app-icons.ts'
import { pngSize } from './png-size.ts'

describe('web install icons', () => {
  it('ships every declared variant at its declared edge', async () => {
    for (const variant of APP_ICON_VARIANTS) {
      expect(pngSize(await readFile(join(ICON_OUTPUT_DIRECTORY, variant.file))))
        .toEqual([variant.size, variant.size])
    }
  })

  it('keeps the full tile and scales only the maskable Nexus artwork', async () => {
    const source = await readFile(TILE_SOURCE, 'utf8')
    const tile = tileDocument(source)
    const maskable = maskableDocument(source)
    expect(tile).toContain('viewBox="0 0 1024 1024"')
    expect(tile).not.toContain(`scale(${MASKABLE_ARTWORK_SCALE})`)
    expect(tile).toContain('<g id="nexus-glyph"')
    expect(tile).toContain(source.match(/<path\b[^>]*>/u)![0])
    expect(tile).toContain(source.match(/<defs>[\s\S]*<\/defs>/u)![0])
    expect(maskable).toContain(`transform="translate(512 512) scale(${MASKABLE_ARTWORK_SCALE}) translate(-512 -512) `)
  })

  // The Nexus tile carries its own rounded inset rect, so the generator no
  // longer rewrites the artwork for the rounded Web variants; that geometry is
  // asserted against the source below rather than against a transform.
  it('takes the rounded tile geometry from the source artwork', async () => {
    const source = await readFile(TILE_SOURCE, 'utf8')
    const macos = await readFile(new URL('../../desktop/resources/icon-macos.svg', import.meta.url), 'utf8')
    const tile = tileDocument(source)
    expect(tile).toContain('viewBox="0 0 1024 1024"')
    // The committed PNGs render this rect directly; nothing re-clips it.
    const sourceRect = tile.match(/<rect\b[^>]*\brx="([^"]+)"/u)
    expect(sourceRect).not.toBeNull()
    const corner = sourceRect![1]
    const tileRects = [...macos.matchAll(/<rect\b[^>]*\bwidth="1024"[^>]*\bheight="1024"[^>]*>/gu)]
    expect(tileRects.map(rect => rect[0].match(/\brx="([^"]+)"/u)?.[1]))
      .toEqual(tileRects.map(() => corner))
  })

  it('rejects non-PNG bytes and incomplete image headers', () => {
    expect(() => pngSize(Buffer.from('<svg/>'))).toThrow(/PNG IHDR/)
    expect(() => pngSize(Buffer.alloc(33))).toThrow(/PNG IHDR/)
  })

  it('fails loudly on a source without the tile it transforms', () => {
    expect(() => tileDocument('')).toThrow(/no Nexus glyph group/)
    expect(() => maskableDocument('<svg></svg>')).toThrow(/no Nexus glyph group/)
  })
})
