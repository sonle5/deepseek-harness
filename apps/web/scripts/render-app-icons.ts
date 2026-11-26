/**
 * Render the install icons of the Web application from the Nexus application tile.
 *
 * Chrome requires a raster 192px/512px pair, prefers a maskable icon for the
 * home screen, and iOS reads `apple-touch-icon`. The maskable variant scales
 * only the Nexus glyph inside the platform safe zone.
 * @module render-app-icons
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Vector source owned by the desktop application. */
export const TILE_SOURCE = fileURLToPath(new URL('../../desktop/resources/icon.svg', import.meta.url))

/** Directory the generated PNGs are committed to. */
export const ICON_OUTPUT_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url))

/** Square source edge. */
const TILE_EDGE = 1024

/** Density at which the source renders at 1:1. */
const SOURCE_DENSITY = 72

/** Samples per output pixel along each axis before reduction. */
const RENDER_SCALE = 4

/** Fraction of a maskable icon the artwork keeps. */
export const MASKABLE_ARTWORK_SCALE = 0.8

/** Radius a platform mask is guaranteed to show, as a fraction of the icon edge. */
export const MASKABLE_SAFE_RADIUS_RATIO = 0.4

/** The only element a maskable icon scales. */
const TILE_ARTWORK_GROUP = /<g id="nexus-glyph" transform="([^"]+)">/u

/** One committed install icon and its raster edge. */
export interface AppIconVariant {
  readonly file: string
  readonly size: number
  readonly kind: 'tile' | 'maskable'
}

/** Install icons the Web application ships. */
export const APP_ICON_VARIANTS: readonly AppIconVariant[] = [
  { file: 'icon-192.png', size: 192, kind: 'tile' },
  { file: 'icon-512.png', size: 512, kind: 'tile' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'tile' },
]

function aboutCenter(scale: number): string {
  return `translate(512 512) scale(${String(scale)}) translate(-512 -512)`
}

/**
 * Validate and return the square tile document.
 * @param source Complete `icon.svg` document.
 * @returns The same document with the required glyph group.
 */
export function tileDocument(source: string): string {
  if (!TILE_ARTWORK_GROUP.test(source)) throw new Error('app icons: the tile source has no Nexus glyph group')
  return source
}

/**
 * Rewrite the tile source into a maskable icon.
 * @param source Complete `icon.svg` document.
 * @returns The icon with only the Nexus glyph scaled inside the safe zone.
 */
export function maskableDocument(source: string): string {
  return tileDocument(source).replace(
    TILE_ARTWORK_GROUP,
    `<g id="nexus-glyph" transform="${aboutCenter(MASKABLE_ARTWORK_SCALE)} $1">`,
  )
}

async function renderPng(document: string, size: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  const renderSize = Math.max(TILE_EDGE, size * RENDER_SCALE)
  const raster = await sharp(Buffer.from(document), { density: SOURCE_DENSITY * renderSize / TILE_EDGE })
    .png()
    .toBuffer()
  return sharp(raster)
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
}

function documentForVariant(source: string, kind: AppIconVariant['kind']): string {
  switch (kind) {
    case 'tile': return tileDocument(source)
    case 'maskable': return maskableDocument(source)
    default: return assertNever(kind)
  }
}

/**
 * Render every install icon from the tile source.
 * @param source Complete `icon.svg` document.
 * @returns One PNG per declared variant.
 */
export async function renderAppIcons(source: string): Promise<readonly { variant: AppIconVariant; png: Buffer }[]> {
  return Promise.all(APP_ICON_VARIANTS.map(async variant => ({
    variant,
    png: await renderPng(documentForVariant(source, variant.kind), variant.size),
  })))
}

async function main(): Promise<void> {
  const icons = await renderAppIcons(await readFile(TILE_SOURCE, 'utf8'))
  await Promise.all(icons.map(async ({ variant, png }) => {
    await writeFile(resolve(ICON_OUTPUT_DIRECTORY, variant.file), png)
  }))
  console.info(`app icons: wrote ${icons.map(icon => icon.variant.file).join(', ')} to ${ICON_OUTPUT_DIRECTORY}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
