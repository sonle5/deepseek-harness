import { describe, expect, it, vi } from 'vitest'
import type { ComposerInvokeResult } from '../src/composer-sidecar.ts'

vi.mock('electron', () => ({ clipboard: {}, dialog: {}, shell: {} }))

const { ComposerShell, COMPOSER_SHELL_COMMANDS, COMPOSER_RESTART_DEFER_MS, isComposerShellCommand } = await import('../src/composer-shell.ts')

function harness(options: {
  open?: { canceled: boolean; filePaths: string[] }
  save?: { canceled: boolean; filePath: string }
  bridge?: ComposerInvokeResult
  openPath?: string
  window?: 'live' | 'destroyed' | 'none'
} = {}) {
  const win = { isDestroyed: () => options.window === 'destroyed' }
  const dialog = {
    showOpenDialog: vi.fn((..._args: unknown[]) => Promise.resolve(options.open ?? { canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn((..._args: unknown[]) => Promise.resolve(options.save ?? { canceled: true, filePath: '' })),
  }
  const shell = { openExternal: vi.fn((_url: string) => Promise.resolve()), openPath: vi.fn((_path: string) => Promise.resolve(options.openPath ?? '')) }
  const clipboard = { writeText: vi.fn((_text: string) => Promise.resolve()) }
  const bridge = vi.fn((_command: string, _args: Record<string, unknown>) => Promise.resolve(options.bridge ?? { ok: '/cfg' }))
  const mkdir = vi.fn((_path: string) => Promise.resolve())
  const restart = vi.fn(() => Promise.resolve())
  const errors: Error[] = []
  const deferred: Array<{ run: () => void; ms: number }> = []
  const navigation: unknown[] = []
  const handler = new ComposerShell({
    window: () => options.window === 'none' ? undefined : win as never,
    bridge, restart, onError: (error) => { errors.push(error) },
    onNavigation: (state) => { navigation.push(state) },
    dialog, shell, clipboard, mkdir, homedir: () => '/Users/me',
    defer: (run, ms) => { deferred.push({ run, ms }) },
  })
  return { handler, win, dialog, shell, clipboard, bridge, mkdir, restart, errors, deferred, navigation }
}

describe('composer shell commands', () => {
  it('lists exactly the shell-owned commands', () => {
    expect([...COMPOSER_SHELL_COMMANDS].sort()).toEqual([
      'copy_text_to_clipboard', 'get_home_dir', 'open_app_config_folder', 'open_config_folder', 'open_external', 'open_file_dialog',
      'open_zip_file_dialog', 'pick_directory', 'publish_navigation_state', 'restart_app', 'save_file_dialog',
    ])
    expect(isComposerShellCommand('get_settings')).toBe(false)
  })

  it('get_home_dir: answers the user home directory', async () => {
    expect(await harness().handler.call('get_home_dir', {})).toEqual({ ok: '/Users/me' })
  })

  it('pick_directory: parents the dialog, trims the default path and returns the folder', async () => {
    const h = harness({ open: { canceled: false, filePaths: ['/picked'] } })
    expect(await h.handler.call('pick_directory', { defaultPath: '  /start ' })).toEqual({ ok: '/picked' })
    expect(h.dialog.showOpenDialog).toHaveBeenCalledWith(h.win, { properties: ['openDirectory', 'createDirectory'], defaultPath: '/start' })
  })

  it('pick_directory: cancel is null and a blank default is ignored', async () => {
    const h = harness({ window: 'destroyed' })
    expect(await h.handler.call('pick_directory', { defaultPath: ' ' })).toEqual({ ok: null })
    expect(h.dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory', 'createDirectory'] })
  })

  it('open_file_dialog: SQL filter, path or null', async () => {
    const h = harness({ open: { canceled: false, filePaths: ['/a.sql'] } })
    expect(await h.handler.call('open_file_dialog', {})).toEqual({ ok: '/a.sql' })
    expect(h.dialog.showOpenDialog).toHaveBeenCalledWith(h.win, { properties: ['openFile'], filters: [{ name: 'SQL', extensions: ['sql'] }] })
    expect(await harness().handler.call('open_file_dialog', {})).toEqual({ ok: null })
  })

  it('open_zip_file_dialog: ZIP / Skill filter', async () => {
    const h = harness({ open: { canceled: false, filePaths: ['/s.skill'] }, window: 'none' })
    expect(await h.handler.call('open_zip_file_dialog', {})).toEqual({ ok: '/s.skill' })
    expect(h.dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile'], filters: [{ name: 'ZIP / Skill', extensions: ['zip', 'skill'] }] })
  })

  it('save_file_dialog: default name with the SQL filter; cancel is null; defaultName is required', async () => {
    const h = harness({ save: { canceled: false, filePath: '/out.sql' } })
    expect(await h.handler.call('save_file_dialog', { defaultName: 'backup.sql' })).toEqual({ ok: '/out.sql' })
    expect(h.dialog.showSaveDialog).toHaveBeenCalledWith(h.win, { filters: [{ name: 'SQL', extensions: ['sql'] }], defaultPath: 'backup.sql' })
    expect(await harness().handler.call('save_file_dialog', { defaultName: 'x' })).toEqual({ ok: null })
    expect(await harness().handler.call('save_file_dialog', {})).toEqual({ bridgeError: { code: 'invalid_arguments', retryable: false } })
  })

  it('open_external: opens https, prefixes a scheme-less link, rejects everything else', async () => {
    const h = harness()
    expect(await h.handler.call('open_external', { url: 'https://onenexus.cloud/' })).toEqual({ ok: true })
    expect(await h.handler.call('open_external', { url: 'github.com/a/b' })).toEqual({ ok: true })
    expect(h.shell.openExternal.mock.calls.map(call => call[0])).toEqual(['https://onenexus.cloud/', 'https://github.com/a/b'])
    for (const url of ['http://example.com/', 'https://user:pw@example.com/', 'https://']) {
      expect(await h.handler.call('open_external', { url })).toMatchObject({ err: expect.stringMatching(/^Failed to open link/) as unknown })
    }
    expect(h.shell.openExternal).toHaveBeenCalledTimes(2)
  })

  it('open_external: an opener failure is a command error', async () => {
    const h = harness()
    h.shell.openExternal.mockRejectedValueOnce(new Error('no browser'))
    expect(await h.handler.call('open_external', { url: 'https://x.test/' })).toEqual({ err: 'Failed to open link: no browser' })
  })

  it('open_config_folder: resolves through get_config_dir, creates and opens it', async () => {
    const h = harness({ bridge: { ok: '/home/.codex' } })
    expect(await h.handler.call('open_config_folder', { app: 'codex' })).toEqual({ ok: true })
    expect(h.bridge).toHaveBeenCalledWith('get_config_dir', { app: 'codex' })
    expect(h.mkdir).toHaveBeenCalledWith('/home/.codex')
    expect(h.shell.openPath).toHaveBeenCalledWith('/home/.codex')
  })

  it('open_config_folder: passes resolution errors through and reports opener failures', async () => {
    expect(await harness({ bridge: { err: 'Invalid app type' } }).handler.call('open_config_folder', { app: 'nope' })).toEqual({ err: 'Invalid app type' })
    expect(await harness({ openPath: 'denied' }).handler.call('open_config_folder', { app: 'claude' })).toEqual({ err: 'Failed to open folder: denied' })
    expect(await harness().handler.call('open_config_folder', {})).toEqual({ bridgeError: { code: 'invalid_arguments', retryable: false } })
  })

  it('open_app_config_folder: opens the parent of get_app_config_path', async () => {
    const h = harness({ bridge: { ok: '/home/.nexus-composer/config.json' } })
    expect(await h.handler.call('open_app_config_folder', {})).toEqual({ ok: true })
    expect(h.bridge).toHaveBeenCalledWith('get_app_config_path', {})
    expect(h.shell.openPath).toHaveBeenCalledWith('/home/.nexus-composer')
  })

  it('copy_text_to_clipboard: writes text, reports failure', async () => {
    const h = harness()
    expect(await h.handler.call('copy_text_to_clipboard', { text: 'hello' })).toEqual({ ok: true })
    expect(h.clipboard.writeText).toHaveBeenCalledWith('hello')
    h.clipboard.writeText.mockRejectedValueOnce(new Error('busy'))
    expect(await h.handler.call('copy_text_to_clipboard', { text: 'x' })).toEqual({ err: 'Failed to write to system clipboard: busy' })
  })

  it('restart_app: answers true first, then restarts the sidecar', async () => {
    const h = harness()
    expect(await h.handler.call('restart_app', {})).toEqual({ ok: true })
    expect(h.restart).not.toHaveBeenCalled()
    expect(h.deferred.map(entry => entry.ms)).toEqual([COMPOSER_RESTART_DEFER_MS])
    h.restart.mockRejectedValueOnce(new Error('spawn failed'))
    h.deferred[0]?.run()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.restart).toHaveBeenCalledOnce()
    expect(h.errors.map(error => error.message)).toEqual(['spawn failed'])
  })

  it('never rejects: a dialog failure becomes a command error', async () => {
    const h = harness()
    h.dialog.showOpenDialog.mockRejectedValueOnce(new Error('dialog broke'))
    expect(await h.handler.call('open_file_dialog', {})).toEqual({ err: 'dialog broke' })
  })
})

describe('composer navigation publishing', () => {
  const state = {
    views: [
      { id: 'providers', label: 'Providers' },
      { id: 'skills', label: 'Skills', app: 'codex' },
    ],
    current: 'skills',
    app: 'codex',
  }

  it('publishes a valid state as a rebuilt copy', async () => {
    const h = harness()
    expect(await h.handler.call('publish_navigation_state', { state: { ...state, extra: 'dropped' } })).toEqual({ ok: true })
    // Field by field: an unknown key on the payload must not reach the sidebar.
    expect(h.navigation).toEqual([state])
  })

  it('rejects a payload the sidebar could not render, keeping the last good state', async () => {
    const h = harness()
    await h.handler.call('publish_navigation_state', { state })
    const rejected = { bridgeError: { code: 'invalid_arguments', retryable: false } }
    const unusable: unknown[] = [
      // Absent or non-object payloads.
      undefined, null, 'state', [],
      // The state's own flags.
      { ...state, app: 'terminal' }, { ...state, app: undefined }, { ...state, views: 'providers' },
      // A view that would render as a blank, unaddressable row.
      { ...state, views: [{ id: '', label: 'Providers' }], current: '' },
      { ...state, views: [{ id: 'providers', label: '' }], current: 'providers' },
      { ...state, views: [null] },
      { ...state, views: [{ id: 'providers', label: 'Providers', app: 'safari' }] },
      // `current` outside the roster leaves no row active.
      { ...state, current: 'agents' },
      // An empty roster necessarily fails the same check.
      { ...state, views: [], current: 'providers' },
    ]
    for (const value of unusable) {
      expect(await h.handler.call('publish_navigation_state', { state: value })).toEqual(rejected)
    }
    expect(h.navigation).toEqual([state])
  })

  it('accepts a view without a tab and a state whose current view is first', async () => {
    const h = harness()
    const views = [{ id: 'settings', label: 'Settings' }]
    expect(await h.handler.call('publish_navigation_state', { state: { views, current: 'settings', app: 'claude' } })).toEqual({ ok: true })
    expect(h.navigation).toEqual([{ views, current: 'settings', app: 'claude' }])
  })
})
