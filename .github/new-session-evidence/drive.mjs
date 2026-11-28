// Temporary evidence capture for Issue 62: drives the packaged app's renderer over CDP.
// Captures the blank home and the first-message state in light and dark, and records the
// composer card's bounding box before and after the first send.
// Usage: node drive.mjs <label> <outDir>; the app must listen on --remote-debugging-port=9222.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const [label, out] = process.argv.slice(2)
const require = createRequire(join(process.cwd(), 'apps/web/package.json'))
const { chromium } = require('playwright')
const log = (line) => { console.log(`[${label}] ${line}`) }

async function connect() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
      for (let wait = 0; wait < 60; wait++) {
        const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('dsh-app://app'))
        if (page !== undefined) return { browser, page }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      throw new Error('no dsh-app page')
    } catch (error) {
      log(`connect attempt ${attempt}: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  throw new Error('renderer never became reachable')
}

const { browser, page } = await connect()
const input = page.locator('[data-composer-input][contenteditable="true"]').first()
const card = page.locator('[data-composer-card]').first()
const geometry = { label, viewport: undefined, empty: {}, firstMessage: {} }

async function bothThemes(name, record) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, `${name}-${scheme}.png`) })
    record[scheme] = await card.boundingBox()
    log(`captured ${name}-${scheme}: ${JSON.stringify(record[scheme])}`)
  }
}

try {
  await input.waitFor({ timeout: 240_000 })
  await page.setViewportSize({ width: 1280, height: 820 })
  geometry.viewport = page.viewportSize()
  await page.waitForTimeout(2000)
  await bothThemes('01-empty', geometry.empty)

  // The placeholder key fails the model request; the user message still starts the transcript.
  await page.emulateMedia({ colorScheme: 'light' })
  await input.click()
  await page.keyboard.type('Reply with the single word LIGHTHOUSE and stop.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(15_000)
  await bothThemes('02-first-message', geometry.firstMessage)

  geometry.delta = Object.fromEntries(['light', 'dark'].map((scheme) => {
    const before = geometry.empty[scheme]
    const after = geometry.firstMessage[scheme]
    return [scheme, before === null || after === null ? null : Object.fromEntries(
      ['x', 'y', 'width', 'height'].map(key => [key, Math.round((after[key] - before[key]) * 100) / 100]),
    )]
  }))
} catch (error) {
  writeFileSync(join(out, 'error.txt'), `${error.stack}\n`)
  await page.screenshot({ path: join(out, 'error.png') }).catch(() => {})
} finally {
  writeFileSync(join(out, 'geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`)
  await browser.close()
}
