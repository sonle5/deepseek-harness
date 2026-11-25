/**
 * Composer's own navigation, drawn in the sidebar's browsing region while the
 * Composer product is selected.
 *
 * Embedded in Superharness the host owns the sidebar, but Composer's views
 * still have to be reachable. Composer publishes them over the host bridge
 * (`ComposerNavigationState`), already localized and in Composer's own order;
 * this layer renders them as the sidebar's rows and routes a press back to the
 * renderer. Codex Desktop's own switcher works the same way — the product
 * brings its navigation with it, and the shell does not invent one.
 *
 * The rows reuse the shell's panel-row material (`.panelEntry` / `.panelRow`
 * in `ui-sidebar`), so a Composer row and a Superharness row are the same
 * height, paint and focus ring. `SidebarRoot` offers its own browsing region as
 * `children`; this layer returns it untouched until Composer has published a
 * navigation state, so the sidebar is never empty while the sidecar starts.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import {
  IconAgentPresetOutlineRegular, IconApiOutlineRegular, IconListPenOutlineRegular, IconSettingsOutlineRegular, IconSkillOutlineRegular,
  IconSparkleRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerNavigationState, ComposerNavigationView } from './composer-bridge.ts'
import type { ProductSwitcherInjected } from './contract.ts'
import css from './ProductSwitcher.module.css'

/**
 * Glyph per view id Composer publishes.
 *
 * The rail is 56px wide and drops the label, so a row without a glyph would be
 * an empty button — unreachable by sight though still focusable. Composer's ids
 * are a closed set published by its own `App.tsx`; an id this shell does not
 * know still gets a row, with a neutral glyph rather than a blank one.
 */
const GLYPHS: Readonly<Record<string, (props: { size?: number }) => React.JSX.Element>> = {
  providers: IconApiOutlineRegular,
  skills: IconSkillOutlineRegular,
  prompts: IconListPenOutlineRegular,
  agents: IconAgentPresetOutlineRegular,
  settings: IconSettingsOutlineRegular,
}

/** Full props of the sidebar navigation layer. */
export type ComposerNavigationProps =
  PropsRuntime<'sidebar.navigation'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>
  // The shell's own browsing region, handed in by SidebarRoot's renderSlot.
  & { children: ReactNode }

/**
 * Whether one Composer row is the current view.
 * @param view - the row's view.
 * @param navigation - Composer's published state.
 * @returns whether the row addresses the view Composer is showing.
 */
function isCurrent(view: ComposerNavigationView, navigation: ComposerNavigationState): boolean {
  if (view.id !== navigation.current) return false
  // Tab-scoped views (Skills, Prompts) exist only under their tab; the id
  // matches but the tab must too, or two rows would light up at once.
  return view.app === undefined || view.app === navigation.app
}

/**
 * @param props - the live product, Composer's published navigation, the switch
 *   and navigate actions, and localized copy.
 * @returns Composer's navigation rows while Composer is the product, else the
 *   shell's own browsing region.
 */
export function ComposerNavigation({ useSwitcher, navigate: navigateTo, t, wide, children }: ComposerNavigationProps) {
  const product = useSwitcher(current => current.product)
  const navigation = useSwitcher(current => current.state.navigation)
  // Not Composer, or nothing published yet: the shell's rows stand.
  if (product !== 'composer' || navigation === undefined) return <>{children}</>
  return (
    <nav className={clsx(css.navigation, !wide && css.navigationRail)} aria-label={t('nav.label')}>
      {navigation.views.map((view) => {
        const current = isCurrent(view, navigation)
        const Glyph = GLYPHS[view.id] ?? IconSparkleRegular
        return (
          <div key={`${view.app ?? ''}:${view.id}`} className={clsx(css.navEntry, wide && css.navEntryWide, current && css.navEntryActive)}>
            <Tooltip label={view.label} delayMs={500} disabled={wide}>
              <button
                type="button"
                className={css.navRow}
                aria-label={view.label}
                aria-current={current ? 'page' : undefined}
                onClick={() => { void navigateTo(view.id, view.app) }}
              >
                {/* Rail icons render at 18, as the shell's own rail does. */}
                <span className={css.navGlyph} aria-hidden="true"><Glyph size={wide ? 16 : 18} /></span>
                {wide && <span className={css.navTitle}>{view.label}</span>}
              </button>
            </Tooltip>
          </div>
        )
      })}
    </nav>
  )
}
