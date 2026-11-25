/** Nexus Superharness occupants for sidebar, blank-home, and hero brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NexusBrandMark, NexusBrandName, NS } from './Brand.tsx'
import { NexusHeroFrame } from './HeroFrame.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

/** Required services: the UI slot registry and the locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Fill every product-owned brand slot with the Nexus identity.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, de, es, fr, ru, pt }), 'Nexus brand: dictionaries')
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
    name: 'conversation.hero.frame',
    id: 'nexus-superharness',
    locale: NS,
  }, NexusHeroFrame))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: NS }, NexusBrandMark))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', locale: NS }, NexusBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, NexusBrandName)
    }))
}
