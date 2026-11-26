// Browser hit testing for the conversation view tabs: each segment accepts
// presses beyond its label, and the segmented pill stays inside the 64px
// chrome row above the Trajectory view's sticky toolbar.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = createChatScrollFixture({
  markerPrefix: 'VIEW_TABS',
  title: 'VIEW_TABS short session',
  turns: 4,
})
const SEED_ID = 'conversation-view-tabs-web-e2e'

/** Label and button rectangles of one tab, and which element owns each probe point. */
interface TabProbe {
  readonly label: { left: number; top: number; right: number; bottom: number }
  readonly button: { left: number; top: number; right: number; bottom: number }
  readonly ownsAboveLabel: boolean
  readonly ownsBesideLabel: boolean
  readonly ownsBarOverhang: boolean
}

/**
 * Probe one tab: the run above and beside its label, and the bar's lowest
 * half pixel, below the button box.
 * @param page - the page under test.
 * @param name - the tab's accessible name.
 * @returns the tab's rectangles and probe owners.
 */
async function probeTab(page: Page, name: string): Promise<TabProbe> {
  return page.getByRole('tab', { name, exact: true }).evaluate((tab) => {
    const range = document.createRange()
    range.selectNodeContents(tab)
    const label = range.getBoundingClientRect()
    const button = tab.getBoundingClientRect()
    const owns = (x: number, y: number): boolean => document.elementFromPoint(x, y)?.closest('[role="tab"]') === tab
    const centerX = (label.left + label.right) / 2
    return {
      label: { left: label.left, top: label.top, right: label.right, bottom: label.bottom },
      button: { left: button.left, top: button.top, right: button.right, bottom: button.bottom },
      ownsAboveLabel: owns(centerX, label.top - 8),
      ownsBesideLabel: owns(label.left - 8, (label.top + label.bottom) / 2),
      ownsBarOverhang: owns(centerX, button.bottom + 0.5),
    }
  })
}

async function openSeededSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  while (await results.count() !== 1) {
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

describe('web e2e: conversation view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('takes presses above and beside the label', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-view-tabs-target'))
    const chat = await probeTab(page, 'Chat')
    // The rebrand turns the view control into a 28px segmented pill: the tab
    // keeps a 4px/10px padding box around its label rather than the retired
    // 35px target with a -10px top margin.
    expect(chat.button.top).toBeLessThanOrEqual(chat.label.top)
    expect(chat.button.left).toBeLessThanOrEqual(chat.label.left - 8)
    expect(chat.ownsBesideLabel).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the selected segment inside the pill', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-conversation-view-tabs-trajectory'))
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const toolbar = page.getByRole('toolbar', { name: 'Trajectory toolbar' })
    await toolbar.waitFor({ timeout: 30_000 })
    const trajectory = await probeTab(page, 'Trajectory')
    // The retired design overhung the header by a bar that met the toolbar; the
    // pill is now contained in the 64px chrome row, so the toolbar starts at or
    // below the header's edge and the tab's own box stays inside it.
    expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(trajectory.button.bottom)
    expect(trajectory.ownsBesideLabel).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })
})
