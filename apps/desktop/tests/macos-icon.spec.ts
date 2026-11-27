import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodeArgb, decodeIcnsElement, encodeArgb, ICNS_ELEMENTS, MACOS_ICON_PATHS, packIcns, unpackIcns, type IconBitmap,
} from '../scripts/render-macos-icon.ts'

/** Alpha bounds of the pixels whose alpha reaches `threshold`, inclusive. */
function alphaBounds({ size, rgba }: IconBitmap, threshold: number): { left: number; top: number; right: number; bottom: number } {
  let left = size, top = size, right = -1, bottom = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3]! < threshold) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return { left, top, right, bottom }
}

async function committedBitmaps(): Promise<Map<string, IconBitmap>> {
  // `iconutil` adds an `info` property list, which holds no image.
  const elements = unpackIcns(readFileSync(MACOS_ICON_PATHS.icns)).filter(element => element.type !== 'info')
  return new Map(await Promise.all(elements.map(async element => [element.type, await decodeIcnsElement(element)] as const)))
}

describe('macOS application icon', () => {
  it('round-trips ARGB planes, including long runs and literal stretches', () => {
    const size = 16
    const rgba = Buffer.alloc(size * size * 4)
    for (let index = 0; index < size * size; index++) {
      rgba[index * 4] = index % 7 === 0 ? index % 256 : 0
      rgba[index * 4 + 3] = index < 200 ? 0 : 255
    }
    const bitmap = { size, rgba }
    expect(decodeArgb(encodeArgb(bitmap), size)).toEqual(bitmap)
  })

  it('rejects malformed ARGB payloads and ICNS files', () => {
    expect(() => decodeArgb(Buffer.from('RGBA'), 16)).toThrow('no ARGB marker')
    expect(() => decodeArgb(Buffer.from('ARGB'), 16)).toThrow('ends inside a channel plane')
    expect(() => decodeArgb(Buffer.concat([Buffer.from('ARGB'), Buffer.from([0xff, 0])]), 1)).toThrow('overflows')
    expect(() => unpackIcns(Buffer.from('icns'))).toThrow('not an ICNS file')
    const truncated = packIcns([{ type: 'ic10', data: Buffer.alloc(4) }])
    truncated.writeUInt32BE(64, 12)
    expect(() => unpackIcns(truncated)).toThrow('length is out of range')
    expect(() => packIcns([{ type: 'ic1', data: Buffer.alloc(0) }])).toThrow('not four characters')
  })

  it('ships every representation macOS selects, at its declared edge', async () => {
    const bitmaps = await committedBitmaps()
    expect([...bitmaps.keys()]).toEqual(ICNS_ELEMENTS.map(element => element.type))
  })

  it('draws the tile on the macOS grid with the shadow inside the canvas', async () => {
    const largest = (await committedBitmaps()).get('ic10')!
    const tile = alphaBounds(largest, 250)
    expect(tile.right - tile.left + 1).toBeCloseTo(824, -1)
    expect(tile.bottom - tile.top + 1).toBeCloseTo(824, -1)
    expect(Math.abs(tile.left - (1023 - tile.right))).toBeLessThanOrEqual(2)
    expect(Math.abs(tile.top - (1023 - tile.bottom))).toBeLessThanOrEqual(2)
    const shadow = alphaBounds(largest, 8)
    expect(Math.min(shadow.left, shadow.top, 1023 - shadow.right, 1023 - shadow.bottom)).toBeGreaterThanOrEqual(8)
  })

  it('keeps a transparent row and column on every side of the 16 and 32 px representations', async () => {
    const bitmaps = await committedBitmaps()
    for (const type of ['ic04', 'ic05', 'ic11']) {
      const bitmap = bitmaps.get(type)!
      const any = alphaBounds(bitmap, 1)
      expect([any.left, any.top, bitmap.size - 1 - any.right, bitmap.size - 1 - any.bottom].every(margin => margin >= 1)).toBe(true)
    }
  })
})
