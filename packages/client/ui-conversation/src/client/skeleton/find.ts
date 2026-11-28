/** Text search over the rendered Conversation transcript and its match highlights. */

/** Highlight registry names styled by `FindBar.module.css`. */
const MATCHES = 'dsh-find'
const CURRENT = 'dsh-find-current'

/**
 * Find every occurrence of a query in an element's rendered text, in document order.
 * Matching ignores case; text inside an excluded subtree, hidden text, and text split across elements is not matched.
 * @param root - transcript container to search.
 * @param query - literal text to find; blank finds nothing.
 * @param exclude - selector of subtrees to skip, such as the composer.
 * @returns one range per occurrence.
 */
export function findText(root: Element, query: string, exclude: string): Range[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return []
  const document = root.ownerDocument
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest(`${exclude}, [hidden], [aria-hidden="true"]`) == null
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  const ranges: Range[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    // Lowercasing keeps offsets aligned for the scripts transcripts carry; a rare length-changing fold is skipped.
    const source = (node as Text).data
    const text = source.toLocaleLowerCase()
    if (text.length !== source.length) continue
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

/** The CSS Custom Highlight API members this module uses; absent in browsers without it. */
interface HighlightApi {
  readonly Highlight: new (...ranges: Range[]) => object
  readonly registry: Map<string, object>
}

function highlightApi(window: Window): HighlightApi | undefined {
  const scope = window as Window & { Highlight?: HighlightApi['Highlight']; CSS?: { highlights?: Map<string, object> } }
  const registry = scope.CSS?.highlights
  return scope.Highlight === undefined || registry === undefined ? undefined : { Highlight: scope.Highlight, registry }
}

/**
 * Paint all matches and the current one; without the Highlight API the current match is selected instead.
 * @param window - window whose highlight registry is written.
 * @param ranges - every match.
 * @param current - index of the current match, ignored when there are none.
 */
export function paintMatches(window: Window, ranges: readonly Range[], current: number): void {
  const api = highlightApi(window)
  const active = ranges[current]
  if (api === undefined) {
    if (active !== undefined) window.getSelection()?.removeAllRanges()
    if (active !== undefined) window.getSelection()?.addRange(active)
    return
  }
  api.registry.set(MATCHES, new api.Highlight(...ranges))
  if (active === undefined) api.registry.delete(CURRENT)
  else api.registry.set(CURRENT, new api.Highlight(active))
}

/**
 * Remove the match highlights.
 * @param window - window whose highlight registry is cleared.
 */
export function clearMatches(window: Window): void {
  const api = highlightApi(window)
  api?.registry.delete(MATCHES)
  api?.registry.delete(CURRENT)
}
