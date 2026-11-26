/** Blank-home frame with a restrained Nexus aura and oversized brand glyph. */
import type { ReactNode } from 'react'
import type { HeroFrameOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NexusBrandMark, NS } from './Brand.tsx'
import css from './HeroFrame.module.css'

/** Frame owner state, the brand copy, and the wrapped Conversation content. */
export type NexusHeroFrameProps = HeroFrameOwnerProps & PropsLocale<typeof NS> & { children: ReactNode }

/**
 * Paint the Nexus atmosphere below the Conversation content.
 * @param props - Blank-home state, the brand copy, and wrapped content.
 * @returns a layout-filling branded frame.
 */
export function NexusHeroFrame({ hero, t, children }: NexusHeroFrameProps) {
  return (
    <div className={css.frame}>
      {hero && (
        <>
          <div className={css.decoration} data-nexus-home="" aria-hidden="true">
            <span className={css.aura} data-nexus-aura="" />
            <span className={css.glyph} data-nexus-glyph="">
              <NexusBrandMark size={420} t={t} />
            </span>
          </div>
          <span className={css.attribution} data-nexus-attribution="">{t('home.attribution')}</span>
        </>
      )}
      {children}
    </div>
  )
}
