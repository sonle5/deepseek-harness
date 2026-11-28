/**
 * The sidebar's Recents section and the search control beside New session
 * through the shipped Web composition: Sessions from two Workspaces interleave
 * by recency, opening one reveals it in the tree, the folded state survives a
 * reload, and the search control opens the field in Recents' place.
 */
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
/** Newest first; the Workspace alternates so the order crosses Workspaces. */
const SESSIONS = [
  { title: 'Recents newest', workspace: 'Recents beta' },
  { title: 'Recents second', workspace: 'Recents alpha' },
  { title: 'Recents third', workspace: 'Recents beta' },
  { title: 'Recents oldest', workspace: 'Recents alpha' },
] as const

describe('web e2e: sidebar Recents', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let betaRoot: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ recentSessionLimit: 3 })
    betaRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-sidebar-recents-')))
    const fixture = await readFile(SEED, 'utf8')
    const workspaces = {
      'Recents alpha': await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Recents alpha'),
      'Recents beta': await scaffold.ctx.workspaceRegistry.create(betaRoot, 'Recents beta'),
    }
    const now = Date.now()
    for (const [index, { title, workspace }] of SESSIONS.entries()) {
      // A Workspace accepts only Sessions whose directory is its own.
      const target = workspace === 'Recents beta' ? { ...scaffold, workspaceCwd: betaRoot } : scaffold
      const id = await seedSession(target, fixture, `sidebar-recents-${index}`, undefined, {
        createdAt: now - (index + 1) * 60_000,
      })
      await workspaces[workspace].attachSession(id)
      await scaffold.ctx.sessionController.rename({ sessionId: id, title })
    }
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
      await scaffold?.close()
    } finally {
      if (betaRoot !== undefined) await rm(betaRoot, { recursive: true, force: true })
    }
  })

  it('lists the newest Sessions across Workspaces and opens one', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-recents'))
    const recents = page.getByRole('region', { name: 'Recents', exact: true })
    // The heading is the one button with aria-expanded; every other button is a row.
    const rows = recents.locator('button:not([aria-expanded])')
    await expect.poll(() => rows.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), { timeout: 10_000 })
      .toEqual(SESSIONS.slice(0, 3).map(({ title, workspace }) => `${title}, ${workspace}`))
    const header = page.locator('[data-sidebar-workspace-header]')
    const [recentsBox, headerBox] = await Promise.all([recents.boundingBox(), header.boundingBox()])
    if (recentsBox === null || headerBox === null) throw new Error('Recents or the Workspaces toolbar has no layout box')
    expect(recentsBox.y + recentsBox.height).toBeLessThanOrEqual(headerBox.y)

    await recents.getByRole('button', { name: 'Recents third, Recents beta', exact: true }).click()
    await expect.poll(() => recents.getByRole('button', { name: 'Recents third, Recents beta', exact: true }).getAttribute('aria-current'))
      .toBe('page')
    await expect.poll(() => page.getByRole('tree', { name: 'Sessions' }).getByRole('treeitem', { selected: true }).textContent())
      .toContain('Recents third')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the folded section across a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-recents-fold'))
    const heading = page.getByRole('button', { name: 'Recents', exact: true })
    await heading.click()
    await expect.poll(() => heading.getAttribute('aria-expanded')).toBe('false')
    await page.reload({ waitUntil: 'load' })
    await expect.poll(() => page.getByRole('button', { name: 'Recents', exact: true }).getAttribute('aria-expanded'), { timeout: 30_000 })
      .toBe('false')
    expect(await page.getByRole('button', { name: 'Recents newest, Recents beta', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Recents', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Recents', exact: true }).getAttribute('aria-expanded')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens search from beside New session in place of Recents', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-recents-search'))
    const search = page.getByRole('button', { name: 'Search sessions', exact: true })
    // The brand mark shares the "New session" name; the row's button is the one beside search.
    const newSession = page.locator('button[class*="newSession"]')
    const [searchBox, newSessionBox] = await Promise.all([search.boundingBox(), newSession.boundingBox()])
    if (searchBox === null || newSessionBox === null) throw new Error('New session row controls have no layout box')
    expect(searchBox.x).toBeGreaterThan(newSessionBox.x + newSessionBox.width - 1)
    expect(Math.abs(searchBox.y + searchBox.height / 2 - newSessionBox.y - newSessionBox.height / 2)).toBeLessThan(1)
    await search.click()
    const input = page.getByPlaceholder('Search session names', { exact: true })
    await expect.poll(() => input.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await page.getByRole('region', { name: 'Recents', exact: true }).count()).toBe(0)
    await input.press('Escape')
    await page.getByRole('region', { name: 'Recents', exact: true }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
  })
})
