/** Workspace command registration and browser-owned opening requests. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionForkError } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCommand, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UiWorkspace } from './navigation.ts'

/** Transient requests consumed by the existing workspace browser. */
export interface WorkspaceShortcutState {
  readonly searchRequest: number
  readonly addRequested: boolean
  readonly directoryBusy: boolean
  readonly renameTarget: { readonly sessionId: SessionId; readonly currentTitle: string } | null
}

interface WorkspaceShortcutControls {
  state: SnapshotStore<WorkspaceShortcutState>
  search: () => void
  add: () => void
  closeAdd: () => void
  directoryBusy: (busy: boolean) => void
  rename: (sessionId: SessionId, currentTitle: string) => void
  closeRename: () => void
}

/**
 * Create the private browser request source shared by commands and controls.
 * @returns observable state and its complete mutation callbacks.
 */
export function createWorkspaceShortcutControls(): WorkspaceShortcutControls {
  const state = createSnapshotStore<WorkspaceShortcutState>({
    searchRequest: 0, addRequested: false, directoryBusy: false, renameTarget: null,
  })
  return {
    state,
    search: () => { state.set({ ...state.getSnapshot(), searchRequest: state.getSnapshot().searchRequest + 1 }) },
    add: () => { state.set(state.getSnapshot().directoryBusy ? state.getSnapshot() : { ...state.getSnapshot(), addRequested: true }) },
    closeAdd: () => { state.set({ ...state.getSnapshot(), addRequested: false }) },
    directoryBusy: (busy: boolean) => { state.set({ ...state.getSnapshot(), directoryBusy: busy }) },
    rename: (sessionId: SessionId, currentTitle: string) => {
      state.set({ ...state.getSnapshot(), renameTarget: { sessionId, currentTitle } })
    },
    closeRename: () => { state.set({ ...state.getSnapshot(), renameTarget: null }) },
  }
}

/** Rendered sidebar rows, queried in display order. */
type SidebarRows = { querySelectorAll(selector: string): Iterable<{ readonly dataset: DOMStringMap }> }

/**
 * Register navigation commands against the existing workspace owner.
 * Rename requires a nonblank main Conversation with no modal other than the navigation drawer obscuring it.
 * Back and Forward also run over the settings dialog, which is itself a view in the window's history.
 * @param ctx - plugin context with the shortcut, locale, and model services.
 * @param navigation - session creation and forking from the pointer controls' navigation service.
 * @param controls - browser-owned opening requests.
 * @param archiveSession - shared archive action, including running-work confirmation and notices.
 * @param reportForkFailure - publish a classified failure through the frame-wide notice channel.
 * @param markSession - shared reading action; only failed writes raise a notice.
 * @param root - container whose rendered sidebar rows order the previous and next Session commands; the page document when omitted.
 */
export function installWorkspaceShortcuts(
  ctx: Context,
  navigation: Pick<UiWorkspace, 'startSession' | 'forkSession' | 'openSession' | 'history' | 'goBack' | 'goForward'>,
  controls: ReturnType<typeof createWorkspaceShortcutControls>,
  archiveSession: (sessionId: SessionId) => void,
  reportForkFailure: (reason: 'unavailable' | 'failed') => void,
  markSession: (sessionId: SessionId, unread: boolean) => void,
  root?: SidebarRows,
): void {
  const t = ctx.locale.bind('workspace')
  const current = () => Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)
  const addReason = () => ctx.slots.entries('sidebar.workspaces.directoryFlow').length === 0
    ? t('shortcut.noPicker')
    : controls.state.getSnapshot().directoryBusy ? t('shortcut.directoryBusy') : null
  const register = (id: string, label: () => string, aliases: string[], code: string,
    modifiers: ('primary' | 'alt' | 'shift')[], webModifiers: ('primary' | 'alt' | 'shift')[], resolve: ShortcutCommand['resolve']): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId, label, aliases, defaults: {
        'desktop:macos': { code, modifiers }, 'desktop:windows': { code, modifiers }, 'desktop:linux': { code, modifiers },
        'web:macos': { code, modifiers: webModifiers }, 'web:windows': { code, modifiers: webModifiers },
      },
      regions: ['page', 'editable'], modals: ['sidebar'], resolve,
    }), `ui-workspace: ${id}`)
  }
  register('session.new', () => t('session.new'), ['new session', 'new chat'], 'KeyN', ['primary'], ['primary', 'alt'],
    () => ({ status: 'handled', run: () => { navigation.startSession() } }))
  register('session.search', () => t('search.sessions.aria'), ['search sessions'], 'KeyK', ['primary'], ['primary', 'alt'],
    () => ({ status: 'handled', run: controls.search }))
  register('workspace.add', () => t('workspace.add'), ['add workspace', 'open folder'], 'KeyO', ['primary'], ['primary', 'alt'],
    () => {
      const reason = addReason()
      return reason === null ? { status: 'handled', run: controls.add } : { status: 'blocked', reason }
    })
  register('session.rename', () => t('rename.session.title'), ['rename session'], 'KeyG', ['primary', 'alt'], ['primary', 'alt'], (context) => {
    const target = current()
    return target === undefined || target.blank || (context.modal !== null && context.modal !== 'sidebar') || ctx.layout.panelInfo.getSnapshot().activePanelId !== null
      ? { status: 'blocked', reason: t('shortcut.noSession') }
      : { status: 'handled', run: () => { controls.rename(target.id, target.title?.trim() ?? '') } }
  })
  register('session.fork', () => t('menu.fork'), ['fork session'], 'KeyF', ['primary', 'alt'], ['primary', 'shift'], () => {
    const target = current()
    if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') }
    if (target.blank) return { status: 'blocked', reason: t('shortcut.noCompletedTurn') }
    return { status: 'handled', run: () => {
      // The main view owns history opening for this target.
      void navigation.forkSession(target.id).catch((error: unknown) => {
        // Client plugin bundles do not share error-class identity.
        const unavailable = error instanceof Error && error.name === 'SessionForkError'
          && (error as SessionForkError).rpcError.code === 'session/fork-unavailable'
        reportForkFailure(unavailable ? 'unavailable' : 'failed')
        if (!unavailable) console.warn('session fork rejected:', error)
      })
    } }
  })
  register('session.archive', () => t('menu.archiveSession'), ['archive session'], 'KeyA', ['primary', 'shift'], ['primary', 'alt'], () => {
    const target = current()
    return target === undefined ? { status: 'blocked', reason: t('shortcut.noSession') }
      : { status: 'handled', run: () => {
        archiveSession(target.id)
      } }
  })
  ctx.effect(() => ctx.shortcuts.register({
    id: 'session.toggleRead' as ShortcutCommandId,
    label: () => t('shortcut.toggleRead'), aliases: ['mark as read', 'mark as unread', 'toggle unread'],
    defaults: {
      'desktop:macos': { code: 'KeyU', modifiers: ['primary', 'shift'] },
      'desktop:windows': { code: 'KeyU', modifiers: ['primary', 'shift'] },
      'web:macos': { code: 'KeyU', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'KeyU', modifiers: ['primary', 'shift'] },
    },
    regions: ['page', 'editable'], modals: [],
    resolve: (context) => {
      const target = current()
      if (target === undefined || target.blank) return { status: 'blocked', reason: t('shortcut.noSession') }
      // Like the row menu, a Peer that may not mark reading has no reading command.
      if (!ctx.remoteAccess.source('session', target.id, 'sessionStatus/mark').getSnapshot()) return { status: 'pass' }
      if (context.modal !== null) return { status: 'blocked', reason: t('shortcut.closeDialog') }
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) return { status: 'blocked', reason: t('shortcut.closePanel') }
      if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.id)) {
        return { status: 'blocked', reason: t('shortcut.archivedReading') }
      }
      const status = ctx.uiSession.sessionStatus
      if (!status.readingReady.getSnapshot()) return { status: 'blocked', reason: t('shortcut.readingUnavailable') }
      const unread = status.getSnapshot().get(target.id)?.completionUnread === true
      return { status: 'handled', run: () => { markSession(target.id, !unread) } }
    },
  }), 'ui-workspace: session.toggleRead')
  // Rendered rows carry the grouping, pinning, manual order and expansion the sidebar shows; a hidden sidebar has none.
  const archived = () => new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds)
  for (const [id, step, code] of [['session.previous', -1, 'BracketLeft'], ['session.next', 1, 'BracketRight']] as const) {
    register(id, () => t(step < 0 ? 'shortcut.previousSession' : 'shortcut.nextSession'),
      [step < 0 ? 'previous session' : 'next session', 'sidebar item'], code, ['primary', 'alt'], ['primary', 'alt'], (context) => {
        if (context.modal !== null && context.modal !== 'sidebar') return { status: 'blocked', reason: t('shortcut.closeDialog') }
        const hidden = archived()
        const rows: SidebarRows = root ?? document
        const ids = [...rows.querySelectorAll('[data-sidebar-list-area] [data-row-key^="session:"]')]
          .flatMap(row => row.dataset.rowKey?.slice('session:'.length) ?? []).map(key => key as SessionId)
          .filter(sessionId => !hidden.has(sessionId))
        const index = ids.indexOf(current()?.id as SessionId)
        const target = ids.at(index < 0 ? (step < 0 ? -1 : 0) : (index + step) % ids.length)
        if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSidebarSessions') }
        return { status: 'handled', run: () => { if (target !== current()?.id) navigation.openSession(target) } }
      })
  }
  for (const [id, step, code] of [['history.back', -1, 'BracketLeft'], ['history.forward', 1, 'BracketRight']] as const) {
    const binding = { code, modifiers: ['primary'] } as const
    // Browsers keep Primary+[ and Primary+] for their own history, and Primary+Alt and Primary+Shift name Session and tab steps.
    const web = { code, modifiers: ['primary', 'alt', 'shift'] } as const
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId, label: () => t(step < 0 ? 'shortcut.back' : 'shortcut.forward'),
      aliases: step < 0 ? ['back', 'go back', 'previous view'] : ['forward', 'go forward', 'next view'],
      defaults: { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding, 'web:macos': web, 'web:windows': web },
      regions: ['page', 'editable'], modals: ['sidebar', 'settings'],
      resolve: (context) => {
        if (context.modal !== null && context.modal !== 'sidebar' && context.modal !== 'settings') {
          return { status: 'blocked', reason: t('shortcut.closeDialog') }
        }
        const { canGoBack, canGoForward } = navigation.history.getSnapshot()
        if (!(step < 0 ? canGoBack : canGoForward)) return { status: 'blocked', reason: t(step < 0 ? 'shortcut.noBack' : 'shortcut.noForward') }
        return { status: 'handled', run: () => { if (step < 0) navigation.goBack(); else navigation.goForward() } }
      },
    }), `ui-workspace: ${id}`)
  }
}
