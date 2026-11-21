// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { NexusBrandMark, NexusBrandName } from '../src/client/Brand.tsx'
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
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, {
      kind: name === 'conversation.hero.frame' ? 'hoc' : 'single',
      scope: 'root',
    }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Nexus browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
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

  it('renders the Orbit Link Nexus mark at the requested host size and its own wordmark', () => {
    const name = render(<NexusBrandName />)
    expect(name.container.textContent).toBe('Nexus Superharness')
    name.unmount()

    const mark = render(<NexusBrandMark size={34} />)
    const svg = mark.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 82 70')
    const paths = [...mark.container.querySelectorAll('path')]
    expect(paths.map(path => path.getAttribute('d'))).toEqual([
      'M16 50C8 40 10 25 22 18C32 12 45 15 50 24',
      'M64 22C72 32 70 47 58 54C48 60 35 57 30 48',
    ])
    const channels = paths[0]?.parentElement
    expect(channels?.getAttribute('stroke')).toBe('currentColor')
    expect(channels?.getAttribute('stroke-width')).toBe('5.5')
    expect([...mark.container.querySelectorAll('circle')].map(circle => `${circle.getAttribute('cx')},${circle.getAttribute('cy')}`))
      .toEqual(['16,50', '64,22', '40,36'])
    expect(mark.container.querySelector('circle')?.getAttribute('fill')).toBe('currentColor')
    mark.rerender(<NexusBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
