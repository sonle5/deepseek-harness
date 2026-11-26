import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import {
  APP_ICON_VARIANTS,
  ICON_OUTPUT_DIRECTORY,
  MASKABLE_ARTWORK_SCALE,
  TILE_SOURCE,
  maskableDocument,
  renderAppIcons,
} from '../scripts/render-app-icons.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships Nexus install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')
  expect(index).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon.png" />')
  expect(index).toContain('<meta name="mobile-web-app-capable" content="yes" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-title" content="Nexus" />')
  expect(index).toContain('<title>Nexus Superharness</title>')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    name: 'Nexus Superharness',
    short_name: 'Nexus',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#EDEFF3',
    theme_color: '#EDEFF3',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
})

it('ships only the declared generated Nexus icons', async () => {
  const source = await readFile(TILE_SOURCE, 'utf8')
  const generated = await renderAppIcons(source)
  const manifest = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8')) as {
    icons: readonly { src: string; sizes: string }[]
  }
  const declared = [...manifest.icons, { src: 'apple-touch-icon.png', sizes: '180x180' }]
  expect(generated.map(({ variant }) => [variant.file, `${variant.size}x${variant.size}`]))
    .toEqual(declared.map(icon => [icon.src, icon.sizes]))
  for (const { variant } of generated) {
    for (const path of [join(ICON_OUTPUT_DIRECTORY, variant.file), join(DIST_ROOT, variant.file)]) {
      const metadata = await sharp(path).metadata()
      expect([metadata.width, metadata.height], path).toEqual([variant.size, variant.size])
      expect(metadata.format, path).toBe('png')
    }
  }
  expect([...APP_ICON_VARIANTS].find(variant => variant.kind === 'maskable')?.size).toBe(512)
  expect(maskableDocument(source)).toContain(`scale(${MASKABLE_ARTWORK_SCALE})`)
})

it('ships fixed-color Nexus monogram favicons selected by document media queries', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon-dark.svg" media="(prefers-color-scheme: dark)" />')
  expect(index).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" media="(prefers-color-scheme: light)" />')
  const light = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  const dark = await readFile(join(DIST_ROOT, 'favicon-dark.svg'), 'utf8')
  expect(light).not.toContain('<style>')
  expect(light).toContain('viewBox="0 0 96 96"')
  expect(light).toContain('stop-color="#101C2B"')
  expect(light).toContain('stop-color="#22D3EE"')
  expect(light).toContain('d="M24 20H37L61 48V20H72V76H59L35 48V76H24Z"')
  expect(dark).toBe(light)
})
