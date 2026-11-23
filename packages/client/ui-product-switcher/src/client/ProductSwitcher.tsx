/**
 * The compact Superharness | Composer control and the two sidebar seats it
 * fills: beside the brand in the expanded logo row, and after the
 * window-chrome controls while the sidebar is hidden.
 *
 * The control is a two-state toggle group rather than a tab list: the two
 * "panels" are the application document and a native view main owns, so there
 * is no second DOM panel a tab could name.
 */
import clsx from 'clsx'
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
  /** Localized accessible name of the group. */
  label: string
  /** Localized Superharness segment text. */
  superharness: string
  /** Localized Composer segment text. */
  composer: string
  /** @param product - the segment the user pressed. */
  onChange: (product: ComposerProduct) => void
  /** Draw the 24px form used in a window-chrome row. */
  compact?: boolean | undefined
}

/**
 * @param props - selected product, localized copy, and the press action.
 * @returns a segmented pair of pressed-state buttons.
 */
export function ProductControl({ value, label, superharness, composer, onChange, compact }: ProductControlProps) {
  return (
    <div role="group" aria-label={label} className={clsx(css.group, compact === true && css.compact)}>
      <button
        type="button"
        className={css.segment}
        aria-pressed={value === 'superharness'}
        onClick={() => { onChange('superharness') }}
      >{superharness}</button>
      <button
        type="button"
        className={css.segment}
        aria-pressed={value === 'composer'}
        onClick={() => { onChange('composer') }}
      >{composer}</button>
    </div>
  )
}

/** Full props of either sidebar seat occupant. */
export type ProductSwitcherProps =
  PropsRuntime<'sidebar.product'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product, the switch action, and localized copy.
 * @returns the product control for the expanded sidebar's logo row.
 */
export function ProductSwitcher({ useSwitcher, select, t }: ProductSwitcherProps) {
  const product = useSwitcher(current => current.product)
  return <ProductControl value={product} label={t('group.label')}
    superharness={t('product.superharness')} composer={t('product.composer')} onChange={select} />
}

/** Full props of the hidden-sidebar seat occupant. */
export type LeadingProductSwitcherProps =
  PropsRuntime<'sidebar.leading.product'>
  & InjectFace<ProductSwitcherInjected>
  & PropsLocale<'productSwitcher'>

/**
 * @param props - the live product, the switch action, and localized copy.
 * @returns the compact product control after the window-chrome buttons.
 */
export function LeadingProductSwitcher({ useSwitcher, select, t }: LeadingProductSwitcherProps) {
  const product = useSwitcher(current => current.product)
  return <ProductControl value={product} label={t('group.label')} compact
    superharness={t('product.superharness')} composer={t('product.composer')} onChange={select} />
}
