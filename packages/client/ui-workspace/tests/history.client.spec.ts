import { describe, expect, it } from 'vitest'
import { NavigationHistory } from '../src/client/history.ts'

const visited = (...entries: string[]) => {
  const history = new NavigationHistory<string>((left, right) => left === right)
  for (const entry of entries) history.push(entry)
  return history
}

describe('NavigationHistory', () => {
  it('starts empty and records visits in order', () => {
    const history = visited()
    expect([history.current, history.canGoBack, history.canGoForward]).toEqual([undefined, false, false])
    expect(history.push('a')).toBe(true)
    expect(history.push('b')).toBe(true)
    expect([history.current, history.canGoBack, history.canGoForward]).toEqual(['b', true, false])
  })

  it('does not record a visit to the current view', () => {
    const history = visited('a')
    expect(history.push('a')).toBe(false)
    expect(history.canGoBack).toBe(false)
  })

  it('steps back and forward through the visits', () => {
    const history = visited('a', 'b', 'c')
    const shown: string[] = []
    const show = (entry: string) => { shown.push(entry); return true }
    expect(history.back(show)).toBe(true)
    expect(history.back(show)).toBe(true)
    expect([history.current, history.canGoBack, history.canGoForward]).toEqual(['a', false, true])
    expect(history.back(show)).toBe(false)
    expect(history.forward(show)).toBe(true)
    expect(history.current).toBe('b')
    expect(shown).toEqual(['b', 'a', 'b'])
  })

  it('drops the forward visits when a new view is visited after going back', () => {
    const history = visited('a', 'b', 'c')
    history.back(() => true)
    history.back(() => true)
    history.push('d')
    expect([history.current, history.canGoForward]).toEqual(['d', false])
    const shown: string[] = []
    history.back((entry) => { shown.push(entry); return true })
    expect(shown).toEqual(['a'])
    expect(history.canGoBack).toBe(false)
  })

  it('skips views that can no longer be shown and stays when none can', () => {
    const history = visited('a', 'gone', 'c')
    expect(history.back(entry => entry !== 'gone')).toBe(true)
    expect(history.current).toBe('a')
    expect(history.forward(() => false)).toBe(false)
    expect(history.current).toBe('a')
  })

  it('replaces the current view without adding a visit', () => {
    const history = visited()
    history.replace('a')
    expect(history.current).toBe('a')
    history.push('b')
    history.replace('c')
    expect(history.current).toBe('c')
    history.back(() => true)
    expect([history.current, history.canGoBack]).toEqual(['a', false])
  })

  it('returns to the covered view when an overlay closes, and records the uncovered view otherwise', () => {
    const history = visited('a', 'settings')
    history.dismiss('a')
    expect([history.current, history.canGoForward]).toEqual(['a', true])
    history.forward(() => true)
    history.dismiss('b')
    expect([history.current, history.canGoBack, history.canGoForward]).toEqual(['b', true, false])
    expect(visited().canGoBack).toBe(false)
    const first = visited('settings')
    first.dismiss('a')
    expect([first.current, first.canGoBack]).toEqual(['a', true])
  })
})
