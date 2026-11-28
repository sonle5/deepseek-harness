/** The sidebar's Session search control, a `sidebar.session.action` layer beside New Session. */
import clsx from 'clsx'
import { IconSearchOutlineMedium, IconSearchOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSearchActionProps } from '../contract/slots.ts'
import css from './SessionSearchAction.module.css'

/**
 * Render the New Session row content, then the search button. The button
 * requests the Workspace browser's search: expanded, the browser opens its
 * search field; on the rail, the sidebar expands first.
 * @param props - slot props; `wide` selects the expanded or rail geometry.
 * @returns the row content followed by the search button.
 */
export function SessionSearchAction({ wide, requestSearch, useShortcuts, t, children }: SessionSearchActionProps) {
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'session.search'))
  return (
    <>
      {children}
      <Tooltip label={t('search')} shortcutKeys={shortcut?.keys} delayMs={500} side={wide ? 'bottom' : 'right'} portal>
        <button
          type="button"
          className={clsx(css.trigger, wide && css.wide)}
          aria-label={t('search.sessions.aria')}
          aria-keyshortcuts={shortcut?.aria}
          data-session-search-trigger=""
          onClick={requestSearch}
        >
          {wide ? <IconSearchOutlineMedium size={14} /> : <IconSearchOutlineRegular size={18} />}
        </button>
      </Tooltip>
    </>
  )
}
