/** Nexus Superharness occupants for sidebar, blank-home, and hero brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NexusBrandMark, NexusBrandName } from './Brand.tsx'
import { NexusHeroFrame } from './HeroFrame.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every product-owned brand slot with the Nexus identity.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
    name: 'conversation.hero.frame',
    id: 'nexus-superharness',
  }, NexusHeroFrame))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, NexusBrandMark))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, NexusBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, NexusBrandName)
    }))
}
