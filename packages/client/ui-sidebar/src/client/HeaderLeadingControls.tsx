/** Window-chrome controls for the fully hidden sidebar (frame shell.leading seat). */
import {
  IconNewChatOutlineRegular, IconPanelLeftOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the frame's shell.leading slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarRootInjected } from './contract/slots.ts'
import { HistoryButtons } from './HistoryButtons.tsx'
import css from './HeaderLeadingControls.module.css'

/** Full props of the shell.leading occupant. */
export type HeaderLeadingControlsProps =
  PropsRuntime<'shell.leading'>
  & PropsRenderSlots<'sidebar.leading.product'>
  & InjectFace<SidebarRootInjected>
  & PropsLocale<'sidebar'>

/**
 * Sidebar-open and New Session controls in the frame's window-chrome seat.
 * The frame mounts this seat for hidden sidebars and owns its placement.
 * Back and Forward follow the opener on every shell; Desktop also retains New Session.
 * @param props - Injected sidebar and history actions, the global access Hook, and the sidebar locale seat.
 * @returns the sidebar toggle, Back and Forward, plus New Session on Desktop while access allows
 * `session/create`, followed by the optional `sidebar.leading.product` occupant.
 */
export function HeaderLeadingControls({
  toggleSidebar, startSession, trackEntryClick, goBack, goForward, useHistory, useRemoteAccess, useShortcuts, renderSlot, t,
}: HeaderLeadingControlsProps) {
  const canGoBack = useHistory(state => state.canGoBack)
  const canGoForward = useHistory(state => state.canGoForward)
  const backShortcut = useShortcuts(rows => rows.find(row => row.id === 'history.back'))
  const forwardShortcut = useShortcuts(rows => rows.find(row => row.id === 'history.forward'))
  // A page whose access snapshot excludes starting a Session keeps only the sidebar toggle here.
  const canStartSession = useRemoteAccess('session/create')
  const desktop = document.documentElement.hasAttribute('data-platform')
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'))
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  return (
    <div className={css.controls}>
      <Tooltip label={t('toggle.open')} shortcutKeys={shortcut?.keys} delayMs={500}>
        <button
          data-sidebar-opener
          type="button"
          className={css.iconButton}
          aria-label={t('toggle.open')}
          aria-keyshortcuts={shortcut?.aria}
          onClick={() => { toggleSidebar() }}
        >
          <IconPanelLeftOutlineRegular size={16} />
        </button>
      </Tooltip>
      <HistoryButtons
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        goBack={goBack}
        goForward={goForward}
        backShortcut={backShortcut}
        forwardShortcut={forwardShortcut}
        backLabel={t('history.back')}
        forwardLabel={t('history.forward')}
        className={css.iconButton as string}
      />
      {desktop && canStartSession && (
        <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('session.new.label')}
            aria-keyshortcuts={newShortcut?.aria}
            onClick={() => {
              trackEntryClick({ menu_name: 'new_session', position: 'titlebar' })
              startSession()
            }}
          >
            <IconNewChatOutlineRegular size={16} />
          </button>
        </Tooltip>
      )}
      {renderSlot('sidebar.leading.product', {})}
    </div>
  )
}
