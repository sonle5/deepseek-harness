/** Conversation navigation spacing preserves the right-pane header alignment. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

describe('conversation header geometry', () => {
  it('uses one 64px chrome row with views as the trailing segmented control', () => {
    const header = css.match(/\.header\s*\{([^}]*)\}/)?.[1]
    expect(header).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(header).toContain('min-height: 64px')
    // The view controls own the grid slot and a definite width; the tab pill
    // inside hugs them. The budget measurement reads the slot, so it must not
    // depend on how many tabs the pill currently shows.
    const controls = css.match(/\.viewControls\s*\{([^}]*)\}/)?.[1]
    expect(controls).toContain('grid-column: 3')
    expect(controls).toContain('width: min(420px, 42vw)')
    const tabs = css.match(/\.tabs\s*\{([^}]*)\}/)?.[1]
    expect(tabs).toContain('border-radius: var(--dsw-radius-md)')
    expect(tabs).toContain('background: var(--dsw-alias-bg-module-platform)')
    const tab = css.match(/\.tab\s*\{([^}]*)\}/)?.[1]
    expect(tab).toContain('min-height: 28px')
    expect(tab).toContain('padding: 4px 10px')
    expect(tab).toContain('font-size: 13px')
    expect(tab).toContain('line-height: 18px')
    expect(tab).toContain('border-radius: var(--dsw-radius-sm)')
    expect(css.match(/\.tabActive\s*\{([^}]*)\}/)?.[1]).toContain('background: var(--dsw-alias-card-fill)')
  })

  it('clips overflowing title actions and fades them inside the gap before the next control', () => {
    const cluster = css.match(/\.titleCluster\s*\{([^}]*)\}/)?.[1]
    expect(cluster).toContain('overflow: clip')
    expect(cluster).toContain('--title-cluster-fade: 20px')
    expect(cluster).toContain('margin: -4px calc(-1 * var(--title-cluster-fade)) -4px -4px')
    expect(cluster).toContain('padding: 4px var(--title-cluster-fade) 4px 4px')
    expect(cluster).toContain('mask-image: linear-gradient(to left, transparent calc(0.3 * var(--title-cluster-fade)), #000 var(--title-cluster-fade))')
    expect(css.match(/^\.headerUtilities\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 20px')
    expect(css.match(/\.titleCluster:has\(\+ \.headerUtilities:empty\)\s*\{([^}]*)\}/)?.[1]).toContain('--title-cluster-fade: 8px')
    expect(css.match(/^\.headerCorner\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 8px')
  })

  it('moves the view control below the title on narrow windows', () => {
    const narrow = /@media \(max-width: 900px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(narrow).toContain('grid-template-rows: minmax(52px, auto) auto')
    expect(narrow).toContain('grid-column: 1 / -1')
    expect(narrow).toContain('grid-row: 2')
  })
})
