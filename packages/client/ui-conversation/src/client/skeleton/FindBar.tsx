/** Find bar over the main Conversation: searches the shown transcript and steps through its matches. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconSearchOutlineRegular, Input, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSlotProps } from '../contract/slots.ts'
import { clearMatches, findText, paintMatches } from './find.ts'
import css from './FindBar.module.css'

/** Props of {@link FindBar}. */
export interface FindBarProps {
  /** Conversation root; matches are searched in its transcript scroll body. */
  readonly container: HTMLElement | null
  /** Increments with each open request; each change focuses and selects the query. */
  readonly request: number
  readonly onClose: () => void
  readonly t: ConversationSlotProps['t']
}

/** Subtrees the search skips: the composer, whose draft is not transcript text, and the bar itself. */
const EXCLUDED = '[data-conversation-region="composer"], [data-conversation-find]'

/**
 * Render the find bar. Typing searches the transcript; Enter and Shift+Enter step forward and back, wrapping at
 * either end, and Escape closes the bar and returns focus to where it was when the bar opened.
 * @param props - transcript container, open-request counter, close action, and the Conversation locale seat.
 * @returns the bar with its query field, match count, step buttons, and close button.
 */
export function FindBar({ container, request, onClose, t }: FindBarProps) {
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<readonly Range[]>([])
  const [current, setCurrent] = useState(0)
  // Set by a query edit or a step, so streamed transcript changes repaint without moving the scroll position.
  const reveal = useRef(false)

  // Each open request moves focus into the field; the element focused before the first request regains it on close.
  useLayoutEffect(() => {
    const field = input.current
    /* v8 ignore next -- the field mounts with the bar, before this effect runs. */
    if (field === null) return
    if (field.ownerDocument.activeElement !== field) returnFocus.current = field.ownerDocument.activeElement
    field.focus()
    field.select()
  }, [request])

  // The transcript keeps rendering while the bar is open, so matches are found again when it changes.
  useEffect(() => {
    if (container === null) return
    const search = () => {
      const transcript = container.querySelector('[data-conversation-scroll]')
      const found = transcript === null ? [] : findText(transcript, query, EXCLUDED)
      setMatches(found)
      setCurrent(index => Math.min(index, Math.max(found.length - 1, 0)))
    }
    search()
    // Composer edits and the bar's own count updates change no transcript text.
    const observer = new MutationObserver((records) => {
      const changed = records.some(({ target }) => (target instanceof Element ? target : target.parentElement)?.closest(EXCLUDED) == null)
      if (changed) search()
    })
    observer.observe(container, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, [container, query])

  useEffect(() => {
    const window = container?.ownerDocument.defaultView
    if (window == null) return
    paintMatches(window, matches, current)
    if (reveal.current) matches[current]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    reveal.current = false
    return () => { clearMatches(window) }
  }, [container, matches, current])

  const step = (delta: 1 | -1) => {
    if (matches.length === 0) return
    reveal.current = true
    setCurrent(index => (index + delta + matches.length) % matches.length)
  }
  const close = () => {
    onClose()
    const target = returnFocus.current
    if (target instanceof HTMLElement && target.isConnected) target.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const hasQuery = query.trim() !== ''
  const count = matches.length === 0
    ? (hasQuery ? t('find.none') : '')
    : t('find.count', { current: current + 1, total: matches.length })
  return (
    <div className={css.bar} role="search" aria-label={t('find.open')} data-conversation-find="">
      <Input
        ref={input}
        className={css.field as string}
        icon={<IconSearchOutlineRegular size={16} />}
        value={query}
        placeholder={t('find.placeholder')}
        aria-label={t('find.open')}
        onChange={(event) => { reveal.current = true; setQuery(event.target.value); setCurrent(0) }}
        onKeyDown={onKeyDown}
      />
      <span className={css.count} aria-live="polite">{count}</span>
      <Tooltip label={t('find.previous')} side="bottom" portal>
        <button type="button" className={css.button} aria-label={t('find.previous')} disabled={matches.length === 0} onClick={() => { step(-1) }}>
          <IconChevronUpOutlineRegular size={16} />
        </button>
      </Tooltip>
      <Tooltip label={t('find.next')} side="bottom" portal>
        <button type="button" className={css.button} aria-label={t('find.next')} disabled={matches.length === 0} onClick={() => { step(1) }}>
          <IconChevronDownOutlineRegular size={16} />
        </button>
      </Tooltip>
      <Tooltip label={t('find.close')} side="bottom" portal>
        <button type="button" className={css.button} aria-label={t('find.close')} onClick={close}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </Tooltip>
    </div>
  )
}
