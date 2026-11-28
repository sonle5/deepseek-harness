// Temporary evidence capture for Issue 63: drives the packaged app's renderer over CDP.
// Usage: node capture.mjs <label> <outDir>; the app must listen on --remote-debugging-port=9222.
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

async function shot(name) {
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(out, `${name}.png`) })
  // Composer crop: the card plus the row that sat above it before the change.
  const box = await card.boundingBox()
  if (box !== null) {
    const viewport = page.viewportSize() ?? { width: 1280, height: 820 }
    const top = Math.max(0, box.y - 64)
    await page.screenshot({
      path: join(out, `${name}-composer.png`),
      clip: { x: Math.max(0, box.x - 16), y: top, width: Math.min(viewport.width, box.width + 32), height: box.y + box.height + 16 - top },
    })
  }
  log(`captured ${name}`)
}

async function bothThemes(name, step) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(600)
    if (step !== undefined) await step()
    await shot(`${name}-${scheme}`)
  }
}

try {
  await input.waitFor({ timeout: 240_000 })
  writeFileSync(join(out, 'placeholder.txt'), `${await input.getAttribute('data-placeholder')}\n`)

  // 1. Empty new-session page with the composer focused.
  await bothThemes('01-empty', async () => { await input.focus() })
  await page.setViewportSize({ width: 640, height: 820 })
  await bothThemes('02-empty-narrow')
  await page.setViewportSize({ width: 1280, height: 820 })

  // 2. In a conversation: one message; the placeholder key fails the model request, which leaves the composer docked.
  await page.emulateMedia({ colorScheme: 'light' })
  await input.click()
  await page.keyboard.type('Summarize the README in this folder.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(15_000)
  await bothThemes('03-conversation')

  // 3. Full access selected through the access chip and its confirmation.
  const access = page.locator('button[aria-label^="Access mode, current:"]').first()
  await access.click()
  await page.getByRole('menuitem', { name: 'Full access' }).click()
  await page.getByRole('checkbox', { name: 'I understand the risks and want to continue' }).click()
  await page.getByRole('button', { name: 'Enable Full access' }).click()
  await page.waitForFunction(() => document.querySelector('button[aria-label="Access mode, current: Full access"]') !== null, null, { timeout: 30_000 })
  await bothThemes('04-full-access')
  const described = await access.evaluate((node) => {
    const id = node.getAttribute('aria-describedby')
    return { dataRisk: node.getAttribute('data-risk'), description: id === null ? null : document.getElementById(id)?.textContent ?? null, color: getComputedStyle(node).color, title: node.title }
  })
  writeFileSync(join(out, 'full-access-chip.json'), `${JSON.stringify(described, null, 2)}\n`)

  // 4. The add button tooltip (where the / and @ triggers are named after the change).
  await page.emulateMedia({ colorScheme: 'light' })
  await page.locator('button[aria-label="Add files or run commands"]').first().hover()
  await page.waitForTimeout(1200)
  await page.waitForTimeout(800)
  const addBox = await card.boundingBox()
  await page.screenshot({ path: join(out, '05-add-tooltip-light.png') })
  if (addBox !== null) {
    await page.screenshot({ path: join(out, '05-add-tooltip-light-composer.png'), clip: { x: Math.max(0, addBox.x - 200), y: Math.max(0, addBox.y - 80), width: addBox.width + 216, height: addBox.height + 96 } })
  }
  log('captured 05-add-tooltip-light')
} catch (error) {
  writeFileSync(join(out, 'error.txt'), `${error.stack}\n`)
  await page.screenshot({ path: join(out, 'error.png') }).catch(() => {})
} finally {
  await browser.close()
}
