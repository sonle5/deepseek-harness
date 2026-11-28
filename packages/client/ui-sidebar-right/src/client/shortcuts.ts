/** Sidebar-owned commands resolved against the currently mounted page. */
import type { Shortcuts, ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightController } from './service.ts'
import type { SidebarRightTarget } from './focus.ts'
import type {} from './locales.ts'

/**
 * Register the sidebar commands over the controller used by its visible controls.
 * @param shortcuts - effective-binding registry for this window.
 * @param sidebar - current Session and page owner.
 * @param t - current localized command and unavailable labels.
 * @param closeWindow - private native close operation using the current configuration revision.
 * @returns release callback for the commands.
 */
export function registerSidebarShortcuts(shortcuts: Pick<Shortcuts, 'register' | 'runtime'>, sidebar: SidebarRightController,
  t: TranslateNS<'sidebarRight'>, closeWindow: () => void): () => void {
  const reason = (kind: 'split' | 'fullscreen', target: SidebarRightTarget): string | null => {
    if (kind === 'split') {
      const block = sidebar.splitBlock(target)
      return block === undefined ? null : t(`command.${block}`)
    }
    if (target.host === 'float') return t('command.float')
    return null
  }
  const disposers = [shortcuts.register({
    id: 'sidebar.right.toggle' as ShortcutCommandId, label: () => t('command.toggle'), aliases: ['right sidebar', 'toggle right panel'],
    defaults: {
      'desktop:macos': { code: 'KeyB', modifiers: ['primary', 'alt'] },
      'desktop:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] },
      'desktop:linux': { code: 'KeyB', modifiers: ['primary', 'alt'] },
      'web:macos': { code: 'KeyB', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'KeyB', modifiers: ['primary', 'shift'] },
    },
    regions: ['page', 'editable', 'terminal'], modals: [],
    resolve: () => {
      const target = sidebar.commandTarget(null)
      if (target === undefined) return { status: 'blocked', reason: t('command.noSession') }
      return { status: 'handled', run: () => { if (sidebar.isTargetCurrent(target)) sidebar.toggleExpanded() } }
    },
  })]
  for (const kind of ['split', 'fullscreen'] as const) {
    const binding: ShortcutBinding = kind === 'split' ? { code: 'Backslash', modifiers: ['primary'] }
      : { code: 'Enter', modifiers: ['primary', 'alt'] }
    disposers.push(shortcuts.register({
      id: (kind === 'split' ? 'pane.split' : 'pane.fullscreen.toggle') as ShortcutCommandId,
      label: () => t(kind === 'split' ? 'dock.splitPane' : 'command.fullscreen'), aliases: [kind, 'panel'],
      defaults: { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding,
        'web:macos': binding, 'web:windows': binding },
      regions: ['page', 'editable', 'terminal'], modals: [],
      resolve: ({ target: element }) => {
        const target = sidebar.focusedTarget(element)
        if (target === undefined) return { status: 'blocked', reason: t('command.noFocus') }
        const unavailable = reason(kind, target)
        if (unavailable !== null) return { status: 'blocked', reason: unavailable }
        return { status: 'handled', run: () => {
          if (!sidebar.isTargetCurrent(target)) return
          if (kind === 'split') sidebar.split(target.paneId)
          else sidebar.toggleFullscreen(target)
        } }
      },
    }))
  }
  for (const kind of ['close', 'refresh'] as const) {
    const desktop: ShortcutBinding = { code: kind === 'close' ? 'KeyW' : 'KeyR', modifiers: ['primary'] }
    const web: ShortcutBinding = { ...desktop, modifiers: ['primary', 'alt'] }
    disposers.push(shortcuts.register({
      id: `page.${kind}` as ShortcutCommandId, label: () => t(`command.${kind}`), aliases: [kind, 'page'],
      defaults: { 'desktop:macos': desktop, 'desktop:windows': desktop, 'desktop:linux': desktop,
        'web:windows': web, ...(kind === 'close' ? { 'web:macos': web } : {}) },
      regions: ['page', 'editable', 'terminal'], modals: kind === 'close' ? ['settings', 'shortcuts', 'platform', 'other'] : [],
      resolve: ({ target: element, source, modal }) => {
        // The Platform page layer registers no close action, so Close page acts as on a page and Desktop closes the window.
        if (kind === 'close' && modal !== null && modal !== 'platform') {
          return { status: 'handled', run: () => { closeTopModal(document) } }
        }
        const target = sidebar.focusedTarget(element)
        if (target === undefined && (source === 'iframe' || element?.closest('[data-sidebar-right-session]'))) {
          return { status: 'blocked', reason: t('command.stale') }
        }
        if (kind === 'refresh') {
          const refresh = target?.occurrence?.commands.refresh
          if (target === undefined || refresh === undefined) return { status: 'blocked', reason: t('command.noRefresh') }
          return { status: 'handled', run: () => {
            if (sidebar.isTargetCurrent(target) && target.occurrence?.commands.refresh === refresh) refresh()
          } }
        }
        if (target !== undefined && sidebar.canCloseTarget(target)) {
          return { status: 'handled', run: () => { sidebar.closeTarget(target) } }
        }
        if (shortcuts.runtime !== 'desktop') return { status: 'blocked', reason: t('command.noFocus') }
        return { status: 'handled', run: () => {
          if (target === undefined || sidebar.isTargetCurrent(target)) closeWindow()
        } }
      },
    }))
  }
  for (const [id, step, code] of [['tab.previous', -1, 'BracketLeft'], ['tab.next', 1, 'BracketRight']] as const) {
    const binding: ShortcutBinding = { code, modifiers: ['primary', 'shift'] }
    disposers.push(shortcuts.register({
      id: id as ShortcutCommandId, label: () => t(step < 0 ? 'command.previousTab' : 'command.nextTab'),
      aliases: [step < 0 ? 'previous tab' : 'next tab', 'switch tab'],
      defaults: { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding,
        'web:windows': binding },
      regions: ['page', 'editable', 'terminal'], modals: [],
      resolve: ({ target: element }) => {
        const target = sidebar.commandTarget(element)
        if (target === undefined) return { status: 'blocked', reason: t(sidebar.active() === undefined ? 'command.noSession' : 'command.collapsed') }
        const tabId = sidebar.cycleTab(target, step)
        if (tabId === undefined) return { status: 'blocked', reason: t('command.noTabs') }
        return { status: 'handled', run: () => { if (sidebar.isTargetCurrent(target)) sidebar.focus(tabId) } }
      },
    }))
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
