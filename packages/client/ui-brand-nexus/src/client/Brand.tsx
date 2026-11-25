import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

type NexusBrandMarkProps = SidebarBrandMarkOwnerProps & {
  readonly className?: string | undefined
}

/** The N monogram Nexus Composer has shipped since its first release. */
export const NEXUS_MONOGRAM = 'M24 20H37L61 48V20H72V76H59L35 48V76H24Z'

/**
 * Render the product monogram: Composer's N, carried over now that the two
 * products are one application. It is a single filled path, so the mark takes
 * its colour from `currentColor` and needs no per-theme artwork.
 * @param props - Host-supplied mark presentation.
 * @returns the Nexus monogram.
 */
export function NexusBrandMark({ size, className }: NexusBrandMarkProps) {
  return (
    <svg
      className={[css.mark, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      data-nexus-brand-mark=""
      role="img"
      aria-label="Nexus Superharness"
    >
      <path d={NEXUS_MONOGRAM} fill="currentColor" />
    </svg>
  )
}

/**
 * Render the Nexus wordmark without its independently slotted mark.
 * @returns the Nexus wordmark.
 */
export function NexusBrandName() {
  return (
    <span className={css.wordmark}>
      <span>{'Nexus Superharness'}</span>
    </span>
  )
}
