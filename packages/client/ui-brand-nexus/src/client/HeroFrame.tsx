/** Blank-home frame with a restrained Nexus aura and oversized brand glyph. */
import type { ReactNode } from 'react'
import type { HeroFrameOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NexusBrandMark } from './Brand.tsx'
import css from './HeroFrame.module.css'

/** Frame owner state and the wrapped Conversation content. */
export type NexusHeroFrameProps = HeroFrameOwnerProps & { children: ReactNode }

/**
 * Paint the Nexus atmosphere below the Conversation content.
 * @param props - Blank-home state and wrapped content.
 * @returns a layout-filling branded frame.
 */
export function NexusHeroFrame({ hero, children }: NexusHeroFrameProps) {
  return (
    <div className={css.frame}>
      {hero && (
        <>
          <div className={css.decoration} data-nexus-home="" aria-hidden="true">
            <span className={css.aura} data-nexus-aura="" />
            <span className={css.glyph} data-nexus-glyph="">
              <NexusBrandMark size={420} />
            </span>
          </div>
          <span className={css.attribution} data-nexus-attribution="">Built on DeepSeek Harness</span>
        </>
      )}
      {children}
    </div>
  )
}
