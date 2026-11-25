// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { NEXUS_MONOGRAM, NexusBrandMark, NexusBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
  'conversation.hero.frame',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  slots.installLocale(locale)
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, {
      kind: name === 'conversation.hero.frame' ? 'hoc' : 'single',
      scope: 'root',
    }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, locale, declareHoles, disposeHoles }
}

/** The brand translate function bound to the package's own namespace. */
function brandT(locale: LocaleRuntime): TranslateNS<'brandNexus'> {
  return locale.bind('brandNexus')
}

describe('Nexus browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses: slots and locale', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('owns every profile-independent product brand hole', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('restores all occupants when declarations return and removes them on teardown', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)

    subject.disposeHoles?.()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    subject.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('renders the Nexus N monogram at the requested host size and its own wordmark', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const t = brandT(subject.locale)

    const name = render(<NexusBrandName t={t} />)
    expect(name.container.textContent).toBe('Nexus Superharness')
    name.unmount()

    const mark = render(<NexusBrandMark size={34} t={t} />)
    const svg = mark.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 96 96')
    const paths = [...mark.container.querySelectorAll('path')]
    expect(paths.map(path => path.getAttribute('d'))).toEqual([NEXUS_MONOGRAM])
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor')
    expect(mark.container.querySelector('circle')).toBeNull()
    mark.rerender(<NexusBrandMark size={24} t={t} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })

  it('registers its own dictionaries so the copy translates with the active locale', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    const t = brandT(subject.locale)
    expect(t('home.attribution')).toBe('Built on DeepSeek Harness')

    subject.locale.setLocale('zh')
    const name = render(<NexusBrandName t={brandT(subject.locale)} />)
    expect(name.container.textContent).toBe('Nexus Superharness')
    expect(brandT(subject.locale)('home.attribution')).toBe('基于 DeepSeek Harness 构建')
    name.unmount()
  })
})
