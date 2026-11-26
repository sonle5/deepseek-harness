/**
 * The product switcher: one button naming the current product, opening a menu
 * of the two products this build can show.
 *
 * In the sidebar it fills the logo row's label seat, with the row's existing
 * brand mark immediately before it — the shape Codex Desktop uses for
 * Codex ⇄ ChatGPT, where the product name *is* the switcher. The mark is not
 * drawn here: `sidebar.brand.mark` owns the identity, so this package cannot
 * drift from it. A separate wordmark beside the trigger would not fit either —
 * the sidebar is 280px and the row already spends most of it on the mark, the
 * name and the panel toggle.
 *
 * The menu is the shared `Menu` primitive, so dismissal, focus return and the
 * menu material all come from the one implementation the rest of the shell
 * uses. The two rows are a radio group: exactly one product is current, and
 * pressing it again is a no-op.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { ComposerProduct } from './composer-bridge.ts'
import type { ProductSwitcherInjected } from './contract.ts'
import css from './ProductSwitcher.module.css'

/** Localized copy and state one product control renders. */
export interface ProductControlProps {
  /** Product this document shows. */
  value: ComposerProduct
  /** Localized accessible name of the control. */
  label: string
  /** Localized Superharness row text. */
  superharness: string
  /** Localized Composer row text. */
  composer: string
  /** @param product - the product the user chose. */
  onChange: (product: ComposerProduct) => void
  /** Draw the 24px form used in a window-chrome row. */
  compact?: boolean | undefined
  /** Fill a sidebar logo row's label seat: brand type, row-height, ellipsizing. */
  brand?: boolean | undefined
}

/** The two products, in menu order. */
const PRODUCTS = ['superharness', 'composer'] as const satisfies readonly ComposerProduct[]

/**
 * @param props - selected product, localized copy, and the select action.
 * @returns one trigger button opening a radio menu of the products.
 */
export function ProductControl({ value, label, superharness, composer, onChange, compact, brand }: ProductControlProps) {
  const [open, setOpen] = useState(false)
  const labels: Record<ComposerProduct, string> = { superharness, composer }
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={PRODUCTS.map(id => ({ id, label: labels[id] }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onChange(id as ComposerProduct)
      }}
      side="bottom"
      align="start"
      // The sidebar logo row clips its overflow, so the list cannot live inside
      // the trigger's box; the shell's own menus portal for the same reason.
      portal
      // The label seat has to grow. The Menu anchor wrapper is a shrink-to-fit
      // flex child, so without this the row's `flex-end` packs the brand group
      // against the panel toggle and leaves the nav-icon column empty above
      // every sidebar row.
      className={brand === true ? css.seat : undefined}
      anchor={(
        <button
          type="button"
          className={clsx(css.trigger, compact === true && css.compact, brand === true && css.brand)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
        >
          <span className={css.name}>{labels[value]}</span>
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    />
  )
}

/** Full props of either sidebar seat occupant. */
export type ProductSwitcherProps =
  PropsRuntime<'sidebar.product'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product, the switch action, and localized copy.
 * @returns the product switcher filling the expanded sidebar logo row's label seat.
 */
export function ProductSwitcher({ useSwitcher, select, t }: ProductSwitcherProps) {
  const product = useSwitcher(current => current.product)
  return <ProductControl value={product} label={t('trigger.label')} brand
    superharness={t('product.superharness')} composer={t('product.composer')} onChange={select} />
}

/** Full props of the hidden-sidebar seat occupant. */
export type LeadingProductSwitcherProps =
  PropsRuntime<'sidebar.leading.product'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product, the switch action, and localized copy.
 * @returns the compact product switcher after the window-chrome buttons.
 */
export function LeadingProductSwitcher({ useSwitcher, select, t }: LeadingProductSwitcherProps) {
  const product = useSwitcher(current => current.product)
  return <ProductControl value={product} label={t('trigger.label')} compact
    superharness={t('product.superharness')} composer={t('product.composer')} onChange={select} />
}
