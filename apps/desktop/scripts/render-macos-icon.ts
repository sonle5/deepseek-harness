/**
 * Render and pack the macOS application icon from `resources/icon-macos.svg`.
 *
 * The vector source is drawn on Apple's 1024-unit app icon grid. It renders
 * once at 1024 pixels, and each smaller representation averages the source
 * pixels it covers. Unlike a resampling kernel, that average adds no alpha
 * outside the artwork, so small sizes keep the source's transparent margin.
 * The committed `resources/icon.icns` is the output. Electron-builder copies it
 * into the application bundle and uses it as the DMG volume icon.
 */

import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Vector source and committed outputs of the macOS application icon. */
export const MACOS_ICON_PATHS = {
  source: fileURLToPath(new URL('../resources/icon-macos.svg', import.meta.url)),
  png: fileURLToPath(new URL('../resources/icon-macos.png', import.meta.url)),
  icns: fileURLToPath(new URL('../resources/icon.icns', import.meta.url)),
} as const

/** Coordinate space of the vector source; sharp's SVG density is scaled against it. */
const SOURCE_EDGE = 1024
const SOURCE_DENSITY = 72
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ICNS_HEADER_BYTES = 8
/** Prefix of an ARGB element's payload; the channel planes follow it. */
const ARGB_MARKER = Buffer.from('ARGB', 'latin1')

/** ICNS element type of each representation and its pixel edge, as `iconutil` writes them. */
export const ICNS_ELEMENTS = [
  { type: 'ic04', size: 16, encoding: 'argb' },
  { type: 'ic05', size: 32, encoding: 'argb' },
  { type: 'ic11', size: 32, encoding: 'png' },
  { type: 'ic12', size: 64, encoding: 'png' },
  { type: 'ic07', size: 128, encoding: 'png' },
  { type: 'ic13', size: 256, encoding: 'png' },
  { type: 'ic08', size: 256, encoding: 'png' },
  { type: 'ic14', size: 512, encoding: 'png' },
  { type: 'ic09', size: 512, encoding: 'png' },
  { type: 'ic10', size: 1024, encoding: 'png' },
] as const

/** One square straight-alpha RGBA bitmap. */
export interface IconBitmap {
  readonly size: number
  /** `size * size` RGBA pixels, row by row, with straight alpha. */
  readonly rgba: Buffer
}

/** One element of an ICNS file. */
export interface IcnsElement {
  readonly type: string
  readonly data: Buffer
}

/**
 * Rasterize the vector source at 1024 pixels and area-average it to every requested edge.
 * @param svg - SVG document with a 1024-unit square viewBox.
 * @param sizes - Bitmap edges; each must divide 1024.
 * @returns one bitmap per edge, in the given order.
 */
export async function renderMacOSIconBitmaps(svg: Buffer, sizes: readonly number[]): Promise<IconBitmap[]> {
  const { data, info } = await sharp(svg, { density: SOURCE_DENSITY }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== SOURCE_EDGE || info.height !== SOURCE_EDGE) {
    throw new Error(`macOS icon: source rendered at ${String(info.width)}x${String(info.height)}, expected ${String(SOURCE_EDGE)}`)
  }
  return sizes.map(size => ({ size, rgba: averageDown(data, size) }))
}

function averageDown(source: Buffer, size: number): Buffer {
  const factor = SOURCE_EDGE / size
  if (!Number.isInteger(factor)) throw new Error(`macOS icon: ${String(size)} px does not divide the ${String(SOURCE_EDGE)} px source`)
  const output = Buffer.alloc(size * size * 4)
  const cell = factor * factor
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Colour channels are averaged with alpha weights so transparent pixels do not darken edges.
      let red = 0, green = 0, blue = 0, alpha = 0
      for (let row = y * factor; row < (y + 1) * factor; row++) {
        for (let column = x * factor; column < (x + 1) * factor; column++) {
          const at = (row * SOURCE_EDGE + column) * 4
          const weight = source[at + 3]!
          red += source[at]! * weight
          green += source[at + 1]! * weight
          blue += source[at + 2]! * weight
          alpha += weight
        }
      }
      const at = (y * size + x) * 4
      output[at + 3] = Math.round(alpha / cell)
      if (alpha > 0) {
        output[at] = Math.round(red / alpha)
        output[at + 1] = Math.round(green / alpha)
        output[at + 2] = Math.round(blue / alpha)
      }
    }
  }
  return output
}

/**
 * Encode one bitmap as a PNG stream.
 * @param bitmap - Straight-alpha RGBA bitmap.
 * @returns the PNG bytes.
 */
export function encodePng(bitmap: IconBitmap): Promise<Buffer> {
  return sharp(bitmap.rgba, { raw: { width: bitmap.size, height: bitmap.size, channels: 4 } }).png().toBuffer()
}

/**
 * Encode a bitmap as an ICNS `ARGB` payload: the marker, then the A, R, G and B planes,
 * each compressed with the ICNS run-length scheme.
 * @param bitmap - Straight-alpha RGBA bitmap.
 * @returns the element payload.
 */
export function encodeArgb(bitmap: IconBitmap): Buffer {
  const pixels = bitmap.size * bitmap.size
  const planes = [3, 0, 1, 2].map((channel) => {
    const plane = Buffer.alloc(pixels)
    for (let index = 0; index < pixels; index++) plane[index] = bitmap.rgba[index * 4 + channel]!
    return compressPlane(plane)
  })
  return Buffer.concat([ARGB_MARKER, ...planes])
}

/**
 * Decode an ICNS `ARGB` payload written by {@link encodeArgb} or `iconutil`.
 * @param payload - Element payload, starting with the `ARGB` marker.
 * @param size - Bitmap edge the element type declares.
 * @returns the straight-alpha RGBA bitmap.
 */
export function decodeArgb(payload: Buffer, size: number): IconBitmap {
  if (!payload.subarray(0, ARGB_MARKER.length).equals(ARGB_MARKER)) throw new Error('macOS icon: ARGB element has no ARGB marker')
  const pixels = size * size
  const rgba = Buffer.alloc(pixels * 4)
  let offset = ARGB_MARKER.length
  for (const channel of [3, 0, 1, 2]) {
    let index = 0
    while (index < pixels) {
      const control = payload[offset++]
      if (control === undefined) throw new Error('macOS icon: ARGB element ends inside a channel plane')
      // Below 0x80 the next control + 1 bytes are literal; otherwise one byte repeats control - 0x80 + 3 times.
      const literal = control < 0x80
      const count = literal ? control + 1 : control - 0x80 + 3
      if (index + count > pixels) throw new Error('macOS icon: ARGB run overflows its channel plane')
      for (let step = 0; step < count; step++) {
        const value = payload[literal ? offset + step : offset]
        if (value === undefined) throw new Error('macOS icon: ARGB element ends inside a run')
        rgba[(index + step) * 4 + channel] = value
      }
      offset += literal ? count : 1
      index += count
    }
  }
  if (offset !== payload.length) throw new Error('macOS icon: ARGB element has trailing bytes')
  return { size, rgba }
}

function compressPlane(plane: Buffer): Buffer {
  const output: number[] = []
  let index = 0
  while (index < plane.length) {
    let repeat = 1
    while (repeat < 130 && index + repeat < plane.length && plane[index + repeat] === plane[index]) repeat++
    if (repeat >= 3) {
      output.push(0x80 + repeat - 3, plane[index]!)
      index += repeat
      continue
    }
    const start = index
    // A literal run stops before the next run of three equal bytes, which the repeat form stores more compactly.
    while (index < plane.length && index - start < 128
      && !(index + 2 < plane.length && plane[index] === plane[index + 1] && plane[index] === plane[index + 2])) index++
    output.push(index - start - 1, ...plane.subarray(start, index))
  }
  return Buffer.from(output)
}

/**
 * Render every representation of {@link ICNS_ELEMENTS} from the vector source.
 * @param svg - SVG document with a 1024-unit square viewBox.
 * @returns ICNS elements in {@link ICNS_ELEMENTS} order.
 */
export async function renderMacOSIconElements(svg: Buffer): Promise<IcnsElement[]> {
  const bitmaps = await renderMacOSIconBitmaps(svg, ICNS_ELEMENTS.map(element => element.size))
  return Promise.all(ICNS_ELEMENTS.map(async (element, index) => ({
    type: element.type,
    data: element.encoding === 'argb' ? encodeArgb(bitmaps[index]!) : await encodePng(bitmaps[index]!),
  })))
}

/**
 * Pack elements into one ICNS file.
 * @param elements - Elements with four-character Latin-1 types.
 * @returns the ICNS bytes.
 */
export function packIcns(elements: readonly IcnsElement[]): Buffer {
  const chunks = elements.map((element) => {
    if (Buffer.byteLength(element.type, 'latin1') !== 4) throw new Error(`macOS icon: element type ${JSON.stringify(element.type)} is not four characters`)
    const header = Buffer.alloc(ICNS_HEADER_BYTES)
    header.write(element.type, 0, 'latin1')
    header.writeUInt32BE(ICNS_HEADER_BYTES + element.data.length, 4)
    return Buffer.concat([header, element.data])
  })
  const header = Buffer.alloc(ICNS_HEADER_BYTES)
  header.write('icns', 0, 'latin1')
  header.writeUInt32BE(ICNS_HEADER_BYTES + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

/**
 * Read the elements back out of one ICNS file.
 * @param icns - Bytes written by {@link packIcns} or `iconutil`.
 * @returns elements in file order.
 */
export function unpackIcns(icns: Buffer): IcnsElement[] {
  if (icns.length < ICNS_HEADER_BYTES || icns.toString('latin1', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
    throw new Error('macOS icon: not an ICNS file')
  }
  const elements: IcnsElement[] = []
  let offset = ICNS_HEADER_BYTES
  while (offset < icns.length) {
    if (offset + ICNS_HEADER_BYTES > icns.length) throw new Error('macOS icon: ICNS element header is truncated')
    const length = icns.readUInt32BE(offset + 4)
    if (length < ICNS_HEADER_BYTES || offset + length > icns.length) throw new Error('macOS icon: ICNS element length is out of range')
    elements.push({ type: icns.toString('latin1', offset, offset + 4), data: icns.subarray(offset + ICNS_HEADER_BYTES, offset + length) })
    offset += length
  }
  return elements
}

/**
 * Decode one element of {@link ICNS_ELEMENTS} into its bitmap.
 * @param element - Element read by {@link unpackIcns}.
 * @returns the straight-alpha RGBA bitmap, checked against the type's edge.
 */
export async function decodeIcnsElement(element: IcnsElement): Promise<IconBitmap> {
  const declared = ICNS_ELEMENTS.find(candidate => candidate.type === element.type)
  if (declared === undefined) throw new Error(`macOS icon: unsupported ICNS element ${element.type}`)
  if (declared.encoding === 'argb') return decodeArgb(element.data, declared.size)
  if (!element.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`macOS icon: ${element.type} is not a PNG stream`)
  const { data, info } = await sharp(element.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== declared.size || info.height !== declared.size) {
    throw new Error(`macOS icon: ${element.type} holds ${String(info.width)}x${String(info.height)}, expected ${String(declared.size)}`)
  }
  return { size: declared.size, rgba: data }
}
