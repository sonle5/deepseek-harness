/** Keyless real-profile checks for the default Nexus Superharness identity. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const artifacts = fileURLToPath(new URL('../../../.artifacts/nexus-brand/', import.meta.url))

interface ThemeSettings {
  update(namespace: 'ui-theme', value: { readonly preference: 'light' | 'dark' }): Promise<void>
}

/** A laid-out box flattened to plain numbers, so page-side geometry crosses the boundary typed. */
interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function themeSettings(scaffold: WebScaffold): ThemeSettings {
  const settings: unknown = scaffold.ctx.get('settings')
  if (typeof settings !== 'object'
    || settings === null
    || !('update' in settings)
    || typeof settings.update !== 'function') throw new Error('Web scaffold did not load settings')
  return settings as ThemeSettings
}

describe('Nexus Superharness in the default web profile', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let captureDir: string

  beforeAll(async () => {
    await mkdir(artifacts, { recursive: true })
    captureDir = await mkdtemp(join(artifacts, 'run-'))
    scaffold = await launchWebScaffold({ firstUse: true })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl)
    await page.locator('[data-nexus-home]').waitFor()
    await page.locator('[data-composer-input]').waitFor()
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('renders one non-interactive Nexus blank-home identity with attribution', async () => {
    const decoration = page.locator('[data-nexus-home]')
    expect(await decoration.count()).toBe(1)
    expect(await decoration.getAttribute('aria-hidden')).toBe('true')
    expect(await decoration.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none')
    expect(await page.locator('[data-nexus-aura]').evaluate(node => getComputedStyle(node).backgroundImage))
      .toContain('radial-gradient')
    expect(await page.locator('[data-nexus-glyph] [data-nexus-brand-mark]').count()).toBe(1)
    expect(await page.locator('[data-nexus-attribution]').textContent()).toBe('Built on DeepSeek Harness')
    expect(await page.locator('[data-nexus-brand-mark]').count()).toBeGreaterThan(0)
    const mark = page.locator('[data-nexus-brand-mark]').first()
    expect(await mark.getAttribute('viewBox')).toBe('0 0 96 96')
    expect(await mark.locator('circle').count()).toBe(0)
    expect(await mark.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d')))).toEqual([
      'M24 20H37L61 48V20H72V76H59L35 48V76H24Z',
    ])
    expect(await mark.locator('path').first().getAttribute('fill')).toBe('currentColor')
    await page.screenshot({ path: `${captureDir}/blank-home-light.png`, fullPage: true })
  })

  it('loads the Composer type family with its restrained medium hierarchy', async () => {
    const typography = await page.getByText('Nexus Superharness').first().evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        family: style.fontFamily,
        weight: style.fontWeight,
        loaded: document.fonts.check('500 14px "Space Grotesk"'),
      }
    })
    expect(typography.family).toContain('Space Grotesk')
    expect(typography.weight).toBe('500')
    expect(typography.loaded).toBe(true)
  })

  it('aligns the macOS wordmark with the sidebar navigation gutter', async () => {
    const previousViewport = page.viewportSize()
    const previousPlatform = await page.locator('html').getAttribute('data-platform')
    try {
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.locator('html').evaluate((element) => { element.setAttribute('data-platform', 'darwin') })
      await page.reload()
      const brandMark = page.locator('[data-window-drag] [data-nexus-brand-mark]')
      const firstNavigation = page.locator('nav button[aria-label]').first()
      await brandMark.waitFor()
      await firstNavigation.waitFor()
      const geometry = await page.evaluate((): {
        mark: Box
        glyph: Box
        identity: Box
        toggle: Box
        brand: Box
        brandTextLeft: number
        navigationTextLeft: number
      } => {
        const mark = document.querySelector<SVGElement>('[data-window-drag] [data-nexus-brand-mark]')!
        const navigation = document.querySelector<HTMLButtonElement>('nav button[aria-label]')!
        const glyph = navigation.querySelector<HTMLElement>('span')!
        const brand = mark.closest<HTMLElement>('[data-window-drag]')!
        const identity = mark.closest<HTMLElement>('[aria-hidden="true"]')!
        const toggle = brand.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')!
        const rect = (element: Element): Box => {
          const box = element.getBoundingClientRect()
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          }
        }
        const textLeft = (root: Element, expected: string): number => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (node.textContent?.trim() !== expected) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            return range.getBoundingClientRect().left
          }
          throw new Error(`Missing text ${JSON.stringify(expected)}`)
        }
        return {
          mark: rect(mark),
          glyph: rect(glyph),
          identity: rect(identity),
          toggle: rect(toggle),
          brand: rect(brand),
          brandTextLeft: textLeft(brand, 'Nexus Superharness'),
          navigationTextLeft: textLeft(navigation, navigation.getAttribute('aria-label')!),
        }
      })
      expect(Math.abs(
        geometry.mark.x + geometry.mark.width / 2 - geometry.glyph.x - geometry.glyph.width / 2,
      )).toBeLessThanOrEqual(8)
      expect(Math.abs(geometry.brandTextLeft - geometry.navigationTextLeft)).toBeLessThanOrEqual(8)
      expect(geometry.identity.right).toBeLessThanOrEqual(geometry.toggle.left - 4)
      expect(geometry.identity.left - geometry.brand.left).toBeLessThanOrEqual(8)
      await page.screenshot({ path: `${captureDir}/sidebar-titlebar-darwin.png` })
    } finally {
      if (previousPlatform === null) await page.locator('html').evaluate((element) => { element.removeAttribute('data-platform') })
      else await page.locator('html').evaluate((element, value) => { element.setAttribute('data-platform', value) }, previousPlatform)
      if (previousViewport !== null) await page.setViewportSize(previousViewport)
      await page.reload()
    }
  })

  it('uses the Composer type scale, slate grounds, ink, and teal accent tokens', async () => {
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      return {
        bodySize: body.fontSize,
        bodyLineHeight: body.lineHeight,
        pageGround: body.getPropertyValue('--dsw-alias-bg-base').trim(),
        sidebar: body.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
        ink: body.getPropertyValue('--dsw-alias-label-primary').trim(),
        accent: body.getPropertyValue('--dsw-alias-brand-primary-new-colorprimary-new-color').trim(),
      }
    })
    expect(styles).toMatchObject({
      bodySize: '14px',
      bodyLineHeight: '20px',
      pageGround: '#edeff3',
      sidebar: '#e4e7ec',
      ink: '#15171c',
      accent: '#0e7490',
    })
  })

  it('keeps the composer independent and follows light and dark theme tokens', async () => {
    const auraImage = () => page.locator('[data-nexus-aura]').evaluate(node => getComputedStyle(node).backgroundImage)

    await themeSettings(scaffold).update('ui-theme', { preference: 'light' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull()
    const lightImage = await auraImage()

    await themeSettings(scaffold).update('ui-theme', { preference: 'dark' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('')
    await expect.poll(auraImage).not.toBe(lightImage)
    await page.screenshot({ path: `${captureDir}/blank-home-dark.png`, fullPage: true })

    const input = page.locator('[data-composer-input]')
    await input.fill('Nexus Superharness draft')
    expect(await input.innerText()).toBe('Nexus Superharness draft')

    await themeSettings(scaffold).update('ui-theme', { preference: 'light' })
  })

  it('fits a phone-width blank home without horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const decoration = await page.locator('[data-nexus-home]').boundingBox()
    expect(decoration).not.toBeNull()
    expect(decoration!.x).toBeGreaterThanOrEqual(0)
    expect(decoration!.x + decoration!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: `${captureDir}/blank-home-phone.png`, fullPage: true })
  })
})
