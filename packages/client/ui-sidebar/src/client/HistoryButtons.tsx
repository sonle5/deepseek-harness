/** Back and Forward buttons for the window's view history, placed after the sidebar toggle. */
import {
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'

/** Props of {@link HistoryButtons}. */
export interface HistoryButtonsProps {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly goBack: () => void
  readonly goForward: () => void
  /** Accepted bindings of `history.back` and `history.forward`, when bound. */
  readonly backShortcut: ShortcutCatalogEntry | undefined
  readonly forwardShortcut: ShortcutCatalogEntry | undefined
  readonly backLabel: string
  readonly forwardLabel: string
  /** Class of each button; the parent's icon-button style. */
  readonly className: string
  readonly side?: 'right' | 'bottom'
  readonly portal?: boolean
}

/**
 * Render Back and Forward; a direction without a view is disabled.
 * @param props - history availability, actions, keycaps, localized labels, and the parent's button style.
 * @returns two adjacent buttons.
 */
export function HistoryButtons({
  canGoBack, canGoForward, goBack, goForward, backShortcut, forwardShortcut, backLabel, forwardLabel, className, side = 'right', portal = false,
}: HistoryButtonsProps) {
  const buttons = [
    { label: backLabel, shortcut: backShortcut, enabled: canGoBack, run: goBack, Icon: IconChevronLeftOutlineRegular, direction: 'back' },
    { label: forwardLabel, shortcut: forwardShortcut, enabled: canGoForward, run: goForward, Icon: IconChevronRightOutlineRegular, direction: 'forward' },
  ] as const
  return (
    <>
      {buttons.map(({ label, shortcut, enabled, run, Icon, direction }) => (
        <Tooltip key={direction} label={label} shortcutKeys={shortcut?.keys} delayMs={500} side={side} portal={portal}>
          <button
            type="button"
            data-history={direction}
            className={className}
            aria-label={label}
            aria-keyshortcuts={shortcut?.aria}
            disabled={!enabled}
            onClick={() => { run() }}
          >
            <Icon size={16} />
          </button>
        </Tooltip>
      ))}
    </>
  )
}
