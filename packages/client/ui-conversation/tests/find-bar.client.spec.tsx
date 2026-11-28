// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { FindBar } from '../src/client/skeleton/FindBar.tsx'
import { clearMatches, findText, paintMatches } from '../src/client/skeleton/find.ts'

const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions | boolean) => void>()

const t = makeTranslate(en, commonEn)
const COMPOSER = '[data-conversation-region="composer"]'

/** A stand-in for the CSS Custom Highlight API, which jsdom lacks. */
class FakeHighlight {
  readonly ranges: Range[]
  constructor(...ranges: Range[]) { this.ranges = ranges }
}

function transcript(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = `<header>Alpha header</header><div data-conversation-scroll="">${html}</div>`
  document.body.append(root)
  return root
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('findText', () => {
  it('finds every case-insensitive occurrence outside excluded, hidden, and split text', () => {
    const root = transcript(`<p>Alpha alpha ALPHA</p><p hidden>alpha</p><span aria-hidden="true">alpha</span>
      <div data-conversation-region="composer">alpha draft</div><p>al<b>ph</b>a</p><p>İ pha</p>`)
    const scroll = root.querySelector('[data-conversation-scroll]')!
    expect(findText(scroll, '  alpha ', COMPOSER).map(range => [range.startOffset, range.endOffset, range.toString()]))
      .toEqual([[0, 5, 'Alpha'], [6, 11, 'alpha'], [12, 17, 'ALPHA']])
    expect(findText(scroll, '   ', COMPOSER)).toEqual([])
    // Lowercasing İ changes its length, so that text node is skipped rather than matched at wrong offsets.
    expect(findText(scroll, 'pha', COMPOSER)).toHaveLength(3)
    expect(findText(scroll, 'i', COMPOSER)).toEqual([])
  })

  it('skips text the browser does not render, such as a closed details body', () => {
    // jsdom has no layout; this stand-in reports what Chromium does for <details>.
    Object.defineProperty(Element.prototype, 'checkVisibility', {
      configurable: true,
      value(this: Element) {
        const details = this.closest('details')
        return details === null || details.open || this.closest('summary') !== null
      },
    })
    onTestFinished(() => { Reflect.deleteProperty(Element.prototype, 'checkVisibility') })
    const root = transcript('<details><summary>alpha tool</summary><p>alpha output</p></details><details open><p>alpha open</p></details>')
    expect(findText(root.querySelector('[data-conversation-scroll]')!, 'alpha', COMPOSER).map(range => range.startContainer.textContent))
      .toEqual(['alpha tool', 'alpha open'])
  })
})

describe('match painting', () => {
  it('registers all matches and the current one, then clears both', () => {
    const highlights = new Map<string, object>()
    vi.stubGlobal('Highlight', FakeHighlight)
    vi.stubGlobal('CSS', { highlights })
    const root = transcript('<p>one one</p>')
    const ranges = findText(root, 'one', COMPOSER)
    paintMatches(window, ranges, 1)
    expect((highlights.get('dsh-find') as FakeHighlight).ranges).toEqual(ranges)
    expect((highlights.get('dsh-find-current') as FakeHighlight).ranges).toEqual([ranges[1]])
    paintMatches(window, [], 0)
    expect(highlights.has('dsh-find-current')).toBe(false)
    clearMatches(window)
    expect(highlights.size).toBe(0)
  })

  it('selects the current match where the Highlight API is missing', () => {
    const root = transcript('<p>one two</p>')
    const [range] = findText(root, 'two', COMPOSER)
    paintMatches(window, [range!], 0)
    expect(window.getSelection()?.toString()).toBe('two')
    paintMatches(window, [], 0)
    expect(window.getSelection()?.toString()).toBe('two')
    clearMatches(window)
  })
})

describe('FindBar', () => {
  const mount = (html: string, request = 1) => {
    const root = transcript(html)
    const composer = document.createElement('textarea')
    composer.value = 'my draft'
    root.querySelector('[data-conversation-scroll]')!.append(composer)
    composer.focus()
    const onClose = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const host = root.appendChild(document.createElement('div'))
    const view = render(<FindBar container={root} request={request} onClose={onClose} t={t} />, { container: host })
    const field = screen.getByRole('textbox', { name: 'Find in conversation' }) as HTMLInputElement
    return { root, composer, onClose, view, field }
  }
  const count = () => screen.getByRole('search').querySelector('[aria-live]')!.textContent

  it('focuses the query, counts matches, and steps with Enter and Shift+Enter, wrapping at either end', () => {
    const { field } = mount('<p>red green red</p><p>red</p>')
    expect(document.activeElement).toBe(field)
    expect(count()).toBe('')
    fireEvent.change(field, { target: { value: 'red' } })
    expect(count()).toBe('1 of 3')
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(count()).toBe('2 of 3')
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(count()).toBe('1 of 3')
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(count()).toBe('3 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(count()).toBe('3 of 3')
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field, { key: 'a' })
    expect(count()).toBe('3 of 3')
    fireEvent.change(field, { target: { value: 'blue' } })
    expect(count()).toBe('No results')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next match' }).disabled).toBe(true)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(count()).toBe('No results')
  })

  it('does not search the composer draft and keeps it on close, returning focus to it', () => {
    const { composer, field, onClose } = mount('<p>draft notes</p>')
    fireEvent.change(field, { target: { value: 'draft' } })
    expect(count()).toBe('1 of 1')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(composer)
    expect(composer.value).toBe('my draft')
  })

  it('closes from its button, follows transcript changes without scrolling, and refocuses on a repeated request', async () => {
    const { root, field, onClose, view } = mount('<p>tick</p>')
    fireEvent.change(field, { target: { value: 'tick' } })
    scrollIntoView.mockClear()
    await act(async () => { root.querySelector('[data-conversation-scroll]')!.append(Object.assign(document.createElement('p'), { textContent: 'tick' })) })
    expect(count()).toBe('1 of 2')
    expect(scrollIntoView).not.toHaveBeenCalled()
    field.blur()
    view.rerender(<FindBar container={root} request={2} onClose={onClose} t={t} />)
    expect(document.activeElement).toBe(field)
    // A request while the field has focus keeps the element that had focus before the bar opened.
    view.rerender(<FindBar container={root} request={3} onClose={onClose} t={t} />)
    expect(document.activeElement).toBe(field)
    root.querySelector('textarea')!.remove()
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('searches again for transcript changes but not for composer or bar changes', async () => {
    const highlights = new Map<string, object>()
    vi.stubGlobal('Highlight', FakeHighlight)
    vi.stubGlobal('CSS', { highlights })
    const { root, field } = mount('<p>beta</p><div data-conversation-region="composer"><p>beta</p></div>')
    fireEvent.change(field, { target: { value: 'beta' } })
    expect(count()).toBe('1 of 1')
    const painted = highlights.get('dsh-find')
    await act(async () => {
      root.querySelector(`${COMPOSER} p`)!.append(' beta')
      root.querySelector(`${COMPOSER} p`)!.firstChild!.textContent = 'beta beta'
    })
    expect(highlights.get('dsh-find')).toBe(painted)
    await act(async () => { root.querySelector('p')!.firstChild!.textContent = 'beta beta' })
    expect(count()).toBe('1 of 2')
  })

  it('finds nothing without a container or a transcript', () => {
    // Focus that started outside HTML content is left where the close moves it.
    const svg = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    svg.setAttribute('tabindex', '0')
    svg.focus()
    onTestFinished(() => { svg.remove() })
    const onClose = vi.fn()
    const { rerender } = render(<FindBar container={null} request={1} onClose={onClose} t={t} />)
    const field = screen.getByRole('textbox', { name: 'Find in conversation' })
    fireEvent.change(field, { target: { value: 'x' } })
    expect(count()).toBe('No results')
    const empty = document.createElement('div')
    rerender(<FindBar container={empty} request={1} onClose={onClose} t={t} />)
    expect(count()).toBe('No results')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(svg)
  })
})
