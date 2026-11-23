import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopComposerStandaloneNotice } from '../src/composer-standalone-notice.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-composer-standalone-'))
  roots.push(root)
  const markerPaths = {
    handoff: join(root, 'composer-standalone-handoff-notified'),
    outdated: join(root, 'composer-standalone-outdated-notified'),
  }
  const show = vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>()
  const focus = vi.fn()
  const messages = () => resolveDesktopLocale('en').messages
  const notice = new DesktopComposerStandaloneNotice({ markerPaths, messages, show, focus })
  return { root, markerPaths, show, focus, notice, en: messages() }
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

it('shows the handoff notice once and records it', async () => {
  const f = setup()
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(existsSync(f.markerPaths.handoff)).toBe(true) })
  expect(f.show).toHaveBeenCalledExactlyOnceWith({
    type: 'info', title: f.en.composerStandaloneNoticeTitle,
    message: f.en.composerStandaloneNoticeDetail, buttons: ['OK'], defaultId: 0, cancelId: -1,
  })
  f.notice.report('handoff')
  await flush()
  expect(f.show).toHaveBeenCalledOnce()
})

it('shows the outdated notice with its extra sentence and a separate marker', async () => {
  const f = setup()
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('outdated')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledOnce() })
  const options = f.show.mock.calls[0]![0]
  expect(options.message).toBe(`${f.en.composerStandaloneNoticeDetail} ${f.en.composerStandaloneNoticeOutdated}`)
  await vi.waitFor(() => { expect(existsSync(f.markerPaths.outdated)).toBe(true) })
  expect(existsSync(f.markerPaths.handoff)).toBe(false)
})

it('keeps separate markers so a seen handoff never hides an outdated notice', async () => {
  const f = setup()
  writeFileSync(f.markerPaths.handoff, '')
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  await flush()
  expect(f.show).not.toHaveBeenCalled()
  f.notice.report('outdated')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledOnce() })
})

it('remembers an acknowledgement in memory across a later report', async () => {
  const f = setup()
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledOnce() })
  rmSync(f.markerPaths.handoff)
  f.notice.report('handoff')
  await flush()
  expect(f.show).toHaveBeenCalledOnce()
})

it('coalesces a repeat of the same kind while a prompt is open', async () => {
  const f = setup()
  const response = Promise.withResolvers<MessageBoxReturnValue>()
  f.show.mockReturnValue(response.promise)
  f.notice.report('handoff')
  f.notice.report('handoff')
  expect(f.focus).toHaveBeenCalledOnce()
  expect(f.show).toHaveBeenCalledOnce()
  response.resolve({ response: 0, checkboxChecked: false })
  await response.promise
})

it('keeps cancellation eligible for a later detection and never records it', async () => {
  const f = setup()
  f.show.mockResolvedValue({ response: -1, checkboxChecked: false })
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledOnce() })
  expect(existsSync(f.markerPaths.handoff)).toBe(false)
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledTimes(2) })
  await vi.waitFor(() => { expect(existsSync(f.markerPaths.handoff)).toBe(true) })
})

it('queues the other kind when it arrives while a prompt is open', async () => {
  const f = setup()
  const first = Promise.withResolvers<MessageBoxReturnValue>()
  f.show.mockReturnValueOnce(first.promise).mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  f.notice.report('outdated')
  expect(f.show).toHaveBeenCalledOnce()
  first.resolve({ response: 0, checkboxChecked: false })
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledTimes(2) })
  expect(f.show.mock.calls[1]![0].message).toContain(f.en.composerStandaloneNoticeOutdated)
})

it('does not show or record after disposal', async () => {
  const f = setup()
  const response = Promise.withResolvers<MessageBoxReturnValue>()
  f.show.mockReturnValue(response.promise)
  f.notice.report('handoff')
  f.notice.dispose()
  response.resolve({ response: 0, checkboxChecked: false })
  await response.promise
  await flush()
  f.notice.report('handoff')
  expect(f.show).toHaveBeenCalledOnce()
  expect(existsSync(f.markerPaths.handoff)).toBe(false)
})

it('keeps an acknowledgement in memory when its marker cannot be written', async () => {
  const f = setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  writeFileSync(join(f.root, 'blocker'), '')
  const notice = new DesktopComposerStandaloneNotice({
    markerPaths: { handoff: join(f.root, 'blocker', 'handoff'), outdated: join(f.root, 'blocker', 'outdated') },
    messages: () => resolveDesktopLocale('en').messages, show: f.show, focus: f.focus,
  })
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  notice.report('handoff')
  await vi.waitFor(() => { expect(console.warn).toHaveBeenCalled() })
  notice.report('handoff')
  await flush()
  expect(f.show).toHaveBeenCalledOnce()
})

it('keeps a failed prompt eligible and permits another attempt', async () => {
  const f = setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  f.show.mockRejectedValueOnce(new Error('dialog unavailable'))
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(console.warn).toHaveBeenCalled() })
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  f.notice.report('handoff')
  await vi.waitFor(() => { expect(f.show).toHaveBeenCalledTimes(2) })
})
