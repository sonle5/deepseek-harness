/** Product-window preference IPC and native menu interception during physical-key dispatch/recording. */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { bindingKey, effectiveShortcuts, presentBinding, parseShortcutDefinitions, parseShortcutEdit } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { NormalizedBinding, ShortcutConfigSnapshot, ShortcutDefinition, ShortcutPlatform, ShortcutRevision } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { desktopKeybindings } from './keybindings.ts'
import { DESKTOP_IPC, assertDesktopSender } from './ipc.ts'

/** Registry commands the native application menu can invoke; each item shows its command's accepted binding. */
export const MENU_COMMAND_IDS = ['page.close', 'settings.open', 'session.new', 'workspace.add', 'session.search',
  'sidebar.left.toggle', 'sidebar.right.toggle', 'shortcuts.open', 'terminal.new', 'browser.new',
  'session.previous', 'session.next', 'tab.previous', 'tab.next', 'account.signOut', 'feedback.open'] as const

/** One registry command reachable from the native application menu. */
export type MenuCommandId = typeof MENU_COMMAND_IDS[number]

type MenuKeyInput = Pick<Input, 'code' | 'key' | 'control' | 'alt' | 'shift' | 'meta'>

/**
 * Install application-owned configuration handlers and attach each product window's input lifecycle.
 * @param getWindow - current product window.
 * @param userData - Electron-resolved device preference directory.
 * @param platform - local device platform.
 * @param updateMenu - rebuild the application menu when a menu shortcut accelerator or availability changes.
 * @param overlayInput - Current shell-owned input blocking state for the product window.
 * @returns menu construction, editor key delivery, window attachment, and teardown operations.
 */
export function installDesktopShortcuts(
  getWindow: () => BrowserWindow | undefined, userData: string, platform: ShortcutPlatform, updateMenu: () => void,
  overlayInput: (window: BrowserWindow) => { readonly revision: number; readonly blocked: boolean },
): {
  fileMenu(labels: { fileMenu: string; closePage: string }, items?: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions
  settingsMenuItem(label: string, available?: boolean, focusWindow?: () => void): MenuItemConstructorOptions
  /**
   * Build a native menu item that invokes one registry command through the same path as its key binding.
   * @param commandId - registered product command; the item stays disabled until the product registers it.
   * @param label - localized menu label.
   * @param available - shell-owned availability, such as an entered workspace.
   * @param focusWindow - restores the product window before the command is sent.
   * @returns an item whose accelerator displays the command's accepted single-key binding.
   */
  commandMenuItem(commandId: MenuCommandId, label: string, available?: boolean, focusWindow?: () => void): MenuItemConstructorOptions
  /**
   * Send a native Edit action to the editor without matching user shortcuts.
   * @param keyCode - edit key.
   * @param modifiers - edit modifiers.
   */
  sendEditingKey(keyCode: string, modifiers: Array<'control'>): void
  attach(window: BrowserWindow): void
  /**
   * Keep these commands' menu accelerators from firing while another product's view has focus.
   * @param contents - focused contents outside the product document, such as the Composer view.
   * @param input - native key reaching that contents.
   * @param commandIds - commands that belong to the product document.
   */
  ignoreMenuKeys(contents: Pick<WebContents, 'setIgnoreMenuShortcuts'>, input: MenuKeyInput, commandIds: readonly MenuCommandId[]): void
  /**
   * Intercept an approved browser guest's keys until its lease ends.
   * @param window - owning product window.
   * @param guest - approved browser contents.
   * @param name - main-issued lease used as the webview element name.
   * @returns idempotent listener disposer.
   */
  attachGuest(window: BrowserWindow, guest: WebContents, name: DesktopBrowserLeaseId): () => void
  dispose(): void
} {
  let definitions: readonly ShortcutDefinition[] = []
  let recording = false
  let revision: ShortcutRevision | undefined
  // Accepted bindings of the commands a native menu item can invoke; null while unbound or conflicting.
  let menuBindings = new Map<MenuCommandId, NormalizedBinding | null>()
  let registeredCommands = new Set<string>()
  let editingInput: BrowserWindow['webContents'] | undefined
  const scopedDesktop = platform === 'windows' || platform === 'macos'
  const disposers = new Set<() => void>()
  const guestInputs = new Map<WebContents, { window: BrowserWindow; reset(): void }>()
  const menuAccelerator = (binding: NormalizedBinding | null): string | undefined => presentBinding(binding, platform).aria
    ?.replace('Meta+', platform === 'macos' ? 'Command+' : 'Super+').replace(/Arrow(Up|Down|Left|Right)$/u, '$1')
  // Whether a native key would fire the menu accelerator of one of these commands.
  const matchesMenuKey = (input: MenuKeyInput, commandIds: readonly MenuCommandId[]): boolean => {
    const modifiers = (['control', 'alt', 'shift', 'meta'] as const).filter(modifier => input[modifier])
    return commandIds.some((commandId) => {
      const binding = menuBindings.get(commandId) ?? null
      if (binding === null || binding.secondCode !== undefined || modifiers.join('+') !== binding.modifiers.join('+')) return false
      if (binding.code.startsWith('Key')) return input.key.toUpperCase() === binding.code.slice(3)
      if (binding.code.startsWith('Digit')) return input.key === binding.code.slice(5)
      const acceleratorKey = menuAccelerator(binding)?.split('+').at(-1)
      // Option and Shift change the typed character of punctuation, so the physical code also matches.
      return input.code === binding.code || (acceleratorKey !== undefined && acceleratorKey.length === 1
        && input.key.toUpperCase() === acceleratorKey.toUpperCase())
    })
  }
  const sendMenuClose = (): void => {
    const window = getWindow()
    if (window === undefined || window.isDestroyed() || !window.isFocused() || !window.isEnabled()
      || revision === undefined || recording || overlayInput(window).blocked) return
    window.webContents.send(DESKTOP_IPC.shortcutsInput, { kind: 'menu', commandId: 'page.close', revision })
  }
  const commandEnabled = (commandId: MenuCommandId): boolean => revision !== undefined && registeredCommands.has(commandId)
  function commandMenuItem(
    commandId: MenuCommandId, label: string, available = true, focusWindow?: () => void,
  ): MenuItemConstructorOptions {
    const accelerator = menuAccelerator(menuBindings.get(commandId) ?? null)
    return {
      id: `dsh-${commandId.replaceAll('.', '-')}`,
      label,
      enabled: available && commandEnabled(commandId),
      ...accelerator === undefined ? {} : { accelerator },
      click: () => {
        if (!available || !commandEnabled(commandId) || recording) return
        const current = getWindow()
        if (current === undefined || current.isDestroyed() || !current.isEnabled() || overlayInput(current).blocked) return
        focusWindow?.()
        const window = getWindow()
        if (window === undefined || window.isDestroyed() || (focusWindow === undefined && !window.isFocused()) || !window.isEnabled()
          || overlayInput(window).blocked) return
        window.webContents.send(DESKTOP_IPC.shortcutsInput, { kind: 'menu', commandId, revision })
      },
    }
  }
  // Everything a menu item displays from this module: whether it can run and its accelerator.
  const menuState = (): string => JSON.stringify([revision !== undefined,
    ...MENU_COMMAND_IDS.map(id => [commandEnabled(id), menuAccelerator(menuBindings.get(id) ?? null)])])
  let keys = new Set<string>()
  const publish = (snapshot: ShortcutConfigSnapshot): void => {
    const previousMenu = menuState()
    revision = definitions.length === 0 || snapshot.status === 'loading' ? undefined : snapshot.revision
    registeredCommands = new Set(definitions.map(entry => entry.id))
    const rows = snapshot.status === 'loading' ? [] : effectiveShortcuts(definitions, snapshot.document, 'desktop', platform)
    keys = new Set(rows.flatMap(row => row.binding !== null && row.issue === null && row.conflicts.length === 0
      ? [bindingKey(row.binding)] : []))
    const activeBinding = (id: string): NormalizedBinding | null => {
      const row = rows.find(entry => entry.id === id)
      return row?.issue === null && row.conflicts.length === 0 ? row.binding : null
    }
    menuBindings = new Map(MENU_COMMAND_IDS.map(id => [id, activeBinding(id)]))
    if (previousMenu !== menuState()) updateMenu()
    const window = getWindow()
    if (window !== undefined && !window.isDestroyed() && window.webContents.mainFrame.url.startsWith('dsh-app://app/')) {
      window.webContents.send(DESKTOP_IPC.shortcutsChanged, snapshot)
    }
  }
  const persistence = desktopKeybindings(userData, platform, publish)
  const assertSender = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('desktop shortcuts: rejected sender')
    assertDesktopSender(event, ['app'])
    return window
  }
  ipcMain.handle(DESKTOP_IPC.shortcutsGet, async (event, input: unknown) => {
    assertSender(event)
    definitions = parseShortcutDefinitions(input)
    persistence.setDefinitions(definitions)
    return persistence.readCurrent()
  })
  ipcMain.handle(DESKTOP_IPC.shortcutsEdit, async (event, input: unknown, expectedRevision: unknown) => {
    assertSender(event)
    if (typeof expectedRevision !== 'string') throw new Error('desktop shortcuts: invalid revision')
    return persistence.edit(parseShortcutEdit(input), expectedRevision as ShortcutRevision)
  })
  ipcMain.handle(DESKTOP_IPC.shortcutsRecording, (event, active: unknown) => {
    const window = assertSender(event)
    if (typeof active !== 'boolean') throw new Error('desktop shortcuts: invalid recording state')
    recording = active
    window.webContents.setIgnoreMenuShortcuts(active)
  })
  ipcMain.handle(DESKTOP_IPC.shortcutsCloseWindow, (event, expected: unknown) => {
    const window = assertSender(event)
    if (expected !== revision || revision === undefined || recording || !window.isFocused() || !window.isEnabled()
      || overlayInput(window).blocked) return
    window.close()
  })
  function attachInput(window: BrowserWindow, contents: WebContents, guestName?: DesktopBrowserLeaseId): () => void {
    let deadKey = false
    const held = new Set<string>()
    const consumed = new Map<string, 'press' | 'repeat'>()
    let inputFrame: typeof contents.focusedFrame = null
    let inputRevision: ShortcutRevision | undefined
    let overlayRevision = overlayInput(window).revision
    const resetInput = (): void => {
      deadKey = false; held.clear(); consumed.clear(); inputFrame = null; inputRevision = undefined
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false)
    }
    if (guestName !== undefined) guestInputs.set(contents, { window, reset: resetInput })
    const resetWindow = (): void => {
      resetInput()
      for (const guest of guestInputs.values()) if (guest.window === window) guest.reset()
    }
    const clear = (): void => {
      resetInput()
      if (guestName !== undefined) return
      definitions = []; keys.clear(); recording = false; registeredCommands = new Set()
      persistence.setDefinitions(null)
    }
    const navigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
      if (event.isMainFrame && !event.isSameDocument) clear()
    }
    const beforeInput = (event: Electron.Event, input: Input): void => {
      const overlay = overlayInput(window)
      if (overlay.revision !== overlayRevision) { resetInput(); overlayRevision = overlay.revision }
      if (overlay.blocked) { event.preventDefault(); return }
      if (event.defaultPrevented) { resetInput(); return }
      if (editingInput === contents) {
        held.clear()
        consumed.clear()
        contents.setIgnoreMenuShortcuts(true)
        return
      }
      if (window !== getWindow() || !window.isFocused() || !window.isEnabled() || revision === undefined
        || (guestName !== undefined && !contents.isFocused())) {
        contents.setIgnoreMenuShortcuts(false)
        held.clear()
        consumed.clear()
        return
      }
      const modifiers = (['control', 'alt', 'shift', 'meta'] as const).filter(modifier => input[modifier])
      const key = bindingKey({ code: input.code, modifiers })
      const match = keys.has(key)
      const menuMatch = matchesMenuKey(input, MENU_COMMAND_IDS)
      contents.setIgnoreMenuShortcuts(recording || match || menuMatch)
      const frame = contents.focusedFrame
      const composing = input.isComposing || input.key === 'Dead' || deadKey || input.modifiers.includes('altgr')
      if (input.type === 'keyDown') deadKey = input.key === 'Dead'
      if (recording || composing || frame === null) { held.clear(); consumed.clear(); return }
      let binding: NormalizedBinding = { code: input.code, modifiers }
      let priority = false
      if (scopedDesktop) {
        if (frame !== inputFrame || inputRevision !== revision) { held.clear(); inputFrame = frame; inputRevision = revision }
        const modifierKey = /^(Control|Alt|Shift|Meta)(Left|Right)$/u.test(input.code)
        if (input.type === 'keyUp') {
          // A chord's first key reached the renderer, so its release must reach the same input handlers.
          if (consumed.get(input.code) === 'press') event.preventDefault()
          consumed.delete(input.code)
          held.delete(input.code)
          if (modifierKey) held.clear()
          return
        }
        if (!input.isAutoRepeat) consumed.delete(input.code)
        if (modifierKey) { held.clear(); return }
        if (input.isAutoRepeat && consumed.has(input.code) && !match) { event.preventDefault(); return }
        if (input.isAutoRepeat && !held.has(input.code) && !match) return
        held.add(input.code)
        const codes: [string, ...string[]] = [input.code, ...[...held].filter(value => value !== input.code)]
        codes.sort()
        const pair = { code: codes[0], ...(codes[1] === undefined ? {} : { secondCode: codes[1] }), modifiers }
        priority = keys.has(key)
        if (codes.length === 2 && keys.has(bindingKey(pair))) { binding = pair; priority = true }
      }
      const main = guestName === undefined && frame === contents.mainFrame
      if (!priority && (main || !match)) return
      event.preventDefault()
      if (input.type !== 'keyDown') return
      if (scopedDesktop) {
        if (!input.isAutoRepeat) {
          if (binding.secondCode !== undefined) {
            consumed.set(binding.code, 'repeat')
            consumed.set(binding.secondCode, 'repeat')
          }
          consumed.set(input.code, 'press')
        }
        // Electron can omit both keyups after interception; completed presses cannot seed another chord.
        held.clear()
      }
      let embedding = frame
      while (guestName === undefined && !main && embedding.parent !== null && embedding.parent !== contents.mainFrame) {
        embedding = embedding.parent
      }
      window.webContents.send(DESKTOP_IPC.shortcutsInput, { kind: guestName === undefined ? main ? 'keyboard' : 'iframe' : 'webview',
        revision, frameName: guestName ?? (main ? '' : embedding.name),
        code: binding.code, ...(binding.secondCode === undefined ? {} : { secondCode: binding.secondCode }),
        repeat: input.isAutoRepeat, control: input.control, alt: input.alt, shift: input.shift, meta: input.meta })
    }
    const dispose = (): void => {
      contents.off('did-start-navigation', navigation)
      contents.off('before-input-event', beforeInput)
      contents.off('blur', resetInput)
      contents.off('destroyed', dispose)
      if (guestName === undefined) { window.off('blur', resetWindow); window.off('closed', closed) }
      disposers.delete(dispose)
      guestInputs.delete(contents)
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false)
    }
    const closed = (): void => { clear(); dispose() }
    contents.on('did-start-navigation', navigation)
    contents.on('before-input-event', beforeInput)
    contents.on('blur', resetInput)
    contents.once('destroyed', dispose)
    if (guestName === undefined) { window.on('closed', closed); window.on('blur', resetWindow) }
    disposers.add(dispose)
    return dispose
  }

  return {
    sendEditingKey(keyCode, modifiers) {
      const window = getWindow()
      if (window === undefined || window.isDestroyed() || overlayInput(window).blocked) return
      const contents = [...guestInputs].find(([guest, owner]) => owner.window === window && !guest.isDestroyed() && guest.isFocused())?.[0]
        ?? window.webContents
      contents.focus()
      const previous = editingInput
      editingInput = contents
      try {
        // Electron emits before-input-event synchronously for these editor-owned keys.
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      } finally {
        editingInput = previous
        if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(recording)
      }
    },
    fileMenu: (labels, items = []) => {
      const accelerator = menuAccelerator(menuBindings.get('page.close') ?? null)
      return { label: labels.fileMenu, submenu: [...items, ...items.length === 0 ? [] : [{ type: 'separator' as const }], {
        id: 'dsh-page-close', label: labels.closePage, enabled: revision !== undefined,
        ...accelerator === undefined ? {} : { accelerator },
        click: sendMenuClose,
      }] }
    },
    settingsMenuItem: (label, available, focusWindow) => commandMenuItem('settings.open', label, available, focusWindow),
    commandMenuItem,
    attach(window) { attachInput(window, window.webContents) },
    ignoreMenuKeys(contents, input, commandIds) { contents.setIgnoreMenuShortcuts(matchesMenuKey(input, commandIds)) },
    attachGuest: attachInput,
    dispose() {
      for (const dispose of disposers) dispose()
      persistence.dispose()
      for (const channel of [DESKTOP_IPC.shortcutsGet,
        DESKTOP_IPC.shortcutsEdit, DESKTOP_IPC.shortcutsRecording, DESKTOP_IPC.shortcutsCloseWindow]) {
        ipcMain.removeHandler(channel)
      }
    },
  }
}
