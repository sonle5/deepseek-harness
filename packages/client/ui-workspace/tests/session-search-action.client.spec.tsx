// @vitest-environment jsdom
import { allowAllAccess, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ShortcutCatalogEntry, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionSearchActionProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'
import { SessionSearchAction } from '../src/client/rows/SessionSearchAction.tsx'

afterEach(cleanup)

const unused = (): never => { throw new Error('the search action reads no other standard hooks') }

const searchRow: ShortcutCatalogEntry = {
  id: 'session.search' as ShortcutCommandId, label: 'Search sessions', aliases: [], keys: ['Ctrl', 'K'], aria: 'Control+K',
  binding: null, modified: false, conflicts: [], issue: null,
}

function bench(options: { wide: boolean; catalog?: readonly ShortcutCatalogEntry[] }) {
  const requestSearch = vi.fn()
  const standard: GlobalStandardProps = {
    useSessions: unused, useSessionStatus: unused, useSessionRetainInfo: unused, usePanelInfo: unused, useResource: unused,
    useWorkspaces: unused, useContextMenu: contextMenuHook(), ...allowAllAccess,
  }
  const catalog = options.catalog ?? [searchRow]
  const props: SessionSearchActionProps = {
    ...standard, wide: options.wide, requestSearch,
    useShortcuts: select => select(catalog),
    t: makeTranslate(en, commonEn),
    children: <span data-testid="new-session-content">New session</span>,
  }
  render(<SessionSearchAction {...props} />)
  return { requestSearch }
}

describe('SessionSearchAction', () => {
  it.each([true, false])('keeps the New session row content first and requests search (wide: %s)', (wide) => {
    const { requestSearch } = bench({ wide })
    const content = screen.getByTestId('new-session-content')
    const search = screen.getByRole('button', { name: 'Search sessions' })
    expect(content.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(search.getAttribute('aria-keyshortcuts')).toBe('Control+K')
    fireEvent.click(search)
    expect(requestSearch).toHaveBeenCalledOnce()
  })

  it('omits the shortcut while the catalog has no search row', () => {
    bench({ wide: true, catalog: [] })
    expect(screen.getByRole('button', { name: 'Search sessions' }).hasAttribute('aria-keyshortcuts')).toBe(false)
  })
})
