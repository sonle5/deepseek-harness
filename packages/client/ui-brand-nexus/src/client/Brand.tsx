import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

type NexusBrandMarkProps = SidebarBrandMarkOwnerProps & {
  readonly className?: string | undefined
}

/**
 * Render two supervised actors linked through one coordinator node.
 * @param props - Host-supplied mark presentation.
 * @returns the Nexus mark.
 */
export function NexusBrandMark({ size, className }: NexusBrandMarkProps) {
  return (
    <svg
      className={[css.mark, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 82 70"
      data-nexus-brand-mark=""
      role="img"
      aria-label="Nexus Superharness"
    >
      <g stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 50C8 40 10 25 22 18C32 12 45 15 50 24" fill="none" />
        <path d="M64 22C72 32 70 47 58 54C48 60 35 57 30 48" fill="none" />
        <circle cx="16" cy="50" r="5" fill="currentColor" stroke="none" />
        <circle cx="64" cy="22" r="5" fill="currentColor" stroke="none" />
        <circle cx="40" cy="36" r="4" fill="currentColor" stroke="none" />
      </g>
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
