// Temporary evidence capture for Issue 64: drives the packaged app's renderer over CDP and captures the
// sidebar with two seeded Workspaces and one running Session, in light and dark.
// Usage: node drive.mjs <label> <outDir>; the app must listen on --remote-debugging-port=9222.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const [label, out] = process.argv.slice(2)
const require = createRequire(join(process.cwd(), 'apps/web/package.json'))
const { chromium } = require('playwright')
const log = (line) => { console.log(`[${label}] ${line}`) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function connect() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
      for (let wait = 0; wait < 60; wait++) {
        const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('dsh-app://app'))
        if (page !== undefined) return { browser, page }
        await pause(2000)
      }
      throw new Error('no dsh-app page')
    } catch (error) {
      log(`connect attempt ${attempt}: ${error.message}`)
      await pause(2000)
    }
  }
  throw new Error('renderer never became reachable')
}

const { browser, page } = await connect()
const input = page.locator('[data-composer-input][contenteditable="true"]').first()

async function sidebarText(name) {
  const text = await page.evaluate(() => {
    const list = document.querySelector('[data-sidebar-list-area]')
    const root = list?.closest('aside, nav, [class*="sidebar"]') ?? document.body
    return root.innerText
  })
  writeFileSync(join(out, `${name}.txt`), `${text}\n`)
  const aria = await page.locator('body').ariaSnapshot().catch(error => `aria snapshot failed: ${error.message}`)
  writeFileSync(join(out, `${name}.aria.yml`), `${aria}\n`)
}

async function bothThemes(name) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await pause(1500)
    await page.screenshot({ path: join(out, `${name}-${scheme}.png`) })
    await page.screenshot({ path: join(out, `${name}-${scheme}-sidebar.png`), clip: { x: 0, y: 0, width: 340, height: 820 } })
    log(`captured ${name}-${scheme}`)
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

try {
  await input.waitFor({ timeout: 240_000 })
  await page.setViewportSize({ width: 1280, height: 820 })
  await pause(3000)
  await bothThemes('01-idle')
  await sidebarText('01-idle')

  // The mock endpoint starts the reply and holds the stream, so this Session stays running.
  await input.click()
  await page.keyboard.type('Find why the login test is flaky.')
  await page.keyboard.press('Enter')
  await pause(12_000)
  await bothThemes('02-running')
  await sidebarText('02-running')

  const search = page.getByRole('button', { name: 'Search sessions', exact: true })
  if (await search.count() > 0) {
    await search.first().click()
    await pause(1500)
    await page.screenshot({ path: join(out, '03-search-open-light.png') })
    await page.keyboard.press('Escape')
  }
} catch (error) {
  writeFileSync(join(out, 'error.txt'), `${error.stack}\n`)
  await page.screenshot({ path: join(out, 'error.png') }).catch(() => {})
} finally {
  await browser.close()
}
