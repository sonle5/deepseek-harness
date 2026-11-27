/** Render every committed Nexus Superharness native and installer asset. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { encodePng, MACOS_ICON_PATHS, packIcns, renderMacOSIconBitmaps, renderMacOSIconElements } from './render-macos-icon.ts'
import { packIco, renderTrayIconEntries, TRAY_ICON_SIZES } from './render-tray-icon.ts'

const APP_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const
/** Composer's N monogram, the one mark both products now share. */
const MARK_PATH = 'M24 20H37L61 48V20H72V76H59L35 48V76H24Z'

function markArtwork(color: string, x: number, y: number, size: number): string {
  // The 96-unit box is Composer's own artwork box: the monogram fills half of
  // it horizontally, exactly as it does on the app tile.
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 96 96" preserveAspectRatio="xMidYMid meet"><path d="${MARK_PATH}" fill="${color}"/></svg>`
}

function brandArtwork(width: number, height: number, dark: boolean, compact = false): Buffer {
  const foreground = dark ? '#f8fafc' : '#0f172a'
  const muted = dark ? '#94a3b8' : '#64748b'
  const tile = dark ? '#172033' : '#fafbfc'
  const border = dark ? '#3f4650' : '#bdc2cb'
  const markSize = compact ? Math.min(92, width - 44) : Math.min(96, height * 0.55)
  const markX = compact ? (width - markSize) / 2 : 32
  const markY = compact ? 34 : (height - markSize) / 2
  const textX = compact ? width / 2 : markX + markSize + 24
  const nameY = compact ? markY + markSize + 37 : height / 2 - 6
  const subtitleY = compact ? nameY + 45 : nameY + 28
  const textAnchor = compact ? 'middle' : 'start'
  // The app tile is 87.5 % of its 1024-unit canvas, and Composer's monogram
  // occupies the full 96-unit artwork box inside it. Draw the artwork box at
  // badge ÷ 0.875 so the installer badge shows the same mark-to-tile ratio.
  const markScale = 1 / 0.875
  const markOffset = markSize * (1 - markScale) / 2
  const name = compact
    ? `<text x="${textX}" y="${nameY}" text-anchor="${textAnchor}" fill="${foreground}" font-family="Space Grotesk, Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="600">Nexus</text>
       <text x="${textX}" y="${nameY + 24}" text-anchor="${textAnchor}" fill="${foreground}" font-family="Space Grotesk, Helvetica Neue, Arial, sans-serif" font-size="18" font-weight="600">Superharness</text>
       <text x="${textX}" y="${nameY + 49}" text-anchor="${textAnchor}" fill="${muted}" font-family="Helvetica, Arial, sans-serif" font-size="7" font-weight="600" letter-spacing="1.1">BUILT ON DEEPSEEK</text>
       <text x="${textX}" y="${nameY + 61}" text-anchor="${textAnchor}" fill="${muted}" font-family="Helvetica, Arial, sans-serif" font-size="7" font-weight="600" letter-spacing="1.1">HARNESS</text>`
    : `<text x="${textX}" y="${nameY}" text-anchor="${textAnchor}" fill="${foreground}" font-family="Space Grotesk, Helvetica Neue, Arial, sans-serif" font-size="${Math.round(height * 0.18)}" font-weight="600" letter-spacing="-1.2">Nexus Superharness</text>
       <text x="${textX}" y="${subtitleY}" text-anchor="${textAnchor}" fill="${muted}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(height * 0.058)}" font-weight="600" letter-spacing="1.8">BUILT ON DEEPSEEK HARNESS</text>`
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="nexus-brand" x1="8" y1="10" x2="78" y2="62" gradientUnits="userSpaceOnUse"><stop stop-color="#22d3ee"/><stop offset=".55" stop-color="#0891b2"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="${dark ? '#0f172a' : '#f8fafc'}"/>
    <rect x="${markX}" y="${markY}" width="${markSize}" height="${markSize}" rx="${markSize * 0.23}" fill="${tile}" stroke="${border}" stroke-width="${Math.max(2, markSize * 0.018)}"/>
    ${markArtwork('url(#nexus-brand)', markX + markOffset, markY + markOffset, markSize * markScale)}
    ${name}
  </svg>`)
}

function dmgArtwork(): Buffer {
  return Buffer.from(`<svg width="1320" height="800" viewBox="0 0 1320 800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1060 90) rotate(133) scale(740)">
        <stop stop-color="#22d3ee" stop-opacity=".18"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M48 0H0V48" fill="none" stroke="#94a3b8" stroke-opacity=".13"/>
      </pattern>
    </defs>
    <rect width="1320" height="800" fill="#f8fafc"/>
    <rect width="1320" height="800" fill="url(#grid)"/>
    <rect width="1320" height="800" fill="url(#glow)"/>
    <text x="660" y="192" text-anchor="middle" fill="#15171c" font-family="Space Grotesk, Helvetica Neue, Arial, sans-serif" font-size="58" font-weight="600" letter-spacing="-1.8">Nexus Superharness</text>
    <text x="660" y="234" text-anchor="middle" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="2.2">MOVE THE APP INTO APPLICATIONS</text>
    <path d="M526 407H790" stroke="#0e7490" stroke-width="7" stroke-linecap="round"/>
    <path d="M758 378L797 407L758 436" fill="none" stroke="#0e7490" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="660" y="646" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="1.3">NEXUS SUPERHARNESS · BUILT ON DEEPSEEK HARNESS</text>
  </svg>`)
}

async function renderPng(svg: Buffer, path: string, width: number, height: number): Promise<void> {
  await sharp(svg, { density: 144 }).resize(width, height).png().toFile(path)
}

async function main(): Promise<void> {
  const root = join(import.meta.dirname, '..')
  const resources = join(root, 'resources')
  const installer = join(root, 'installer', 'assets')
  const source = await readFile(join(resources, 'icon.svg'))
  const windowsSource = await readFile(join(resources, 'icon-windows.svg'))
  await Promise.all([
    renderPng(source, join(resources, 'icon-windows.png'), 1024, 1024),
    renderPng(source, join(resources, 'icon.png'), 1024, 1024),
    renderPng(brandArtwork(600, 196, false), join(installer, 'brand.png'), 600, 196),
    renderPng(brandArtwork(1200, 392, false), join(installer, 'brand-2x.png'), 1200, 392),
    renderPng(brandArtwork(600, 196, true), join(installer, 'brand-dark.png'), 600, 196),
    renderPng(brandArtwork(1200, 392, true), join(installer, 'brand-dark-2x.png'), 1200, 392),
    renderPng(brandArtwork(164, 314, false, true), join(installer, 'uninstaller-sidebar.png'), 164, 314),
    renderPng(dmgArtwork(), join(installer, 'dmg-background.png'), 1320, 800),
  ])
  await writeFile(join(resources, 'icon-windows.ico'), packIco(await renderTrayIconEntries(windowsSource, APP_ICON_SIZES)))
  await writeFile(join(resources, 'tray-windows.ico'), packIco(await renderTrayIconEntries(
    windowsSource,
    TRAY_ICON_SIZES,
  )))
  const macOSSource = await readFile(MACOS_ICON_PATHS.source)
  const [macOSPng] = await renderMacOSIconBitmaps(macOSSource, [1024])
  await writeFile(MACOS_ICON_PATHS.png, await encodePng(macOSPng!))
  await writeFile(MACOS_ICON_PATHS.icns, packIcns(await renderMacOSIconElements(macOSSource)))
}

await main()
