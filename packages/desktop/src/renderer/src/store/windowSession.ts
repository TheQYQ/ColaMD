import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { useMainStore } from '.'
import { createBufferedEditorState, createDocumentState } from './help'
import { initialTabsToOpen } from './tabOps'
import type { BootstrapEditorConfig, IFileState } from '@shared/types/files'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(15) — the two ways a window gets its first tabs: the bootstrap message
// main sends on creation, and the crash-buffer snapshot the user is restored
// from. Moved out of the `actions` object in `editor.ts` verbatim; the store
// keeps one-line delegations, and every call that used to be `this.X()` still
// goes through `store.X()` so the action dispatch point does not move.

export const applyBootstrapEditor = (store: EditorStore, config: BootstrapEditorConfig): void => {
  const {
    welcomeMarkdown,
    addBlankTab,
    markdownList,
    lineEnding,
    sideBarVisibility,
    tabBarVisibility,
    sourceCodeModeEnabled
  } = config

  const preferencesStore = usePreferencesStore()
  const layoutStore = useLayoutStore()
  const mainStore = useMainStore()

  mainStore.SET_INITIALIZED()
  preferencesStore.SET_USER_PREFERENCE({ endOfLine: lineEnding })
  layoutStore.SET_LAYOUT({
    rightColumn: 'files',
    showSideBar: !!sideBarVisibility,
    showTabBar: !!tabBarVisibility
  })
  layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
  preferencesStore.SET_MODE({ type: 'sourceCode', checked: !!sourceCodeModeEnabled })

  for (const request of initialTabsToOpen({ welcomeMarkdown, addBlankTab, markdownList })) {
    store.NEW_UNTITLED_TAB(request)
  }
}

export const restoreBufferedEditorState = (store: EditorStore, state: unknown): void => {
  const rawState = state as { editor?: unknown; project?: unknown; layout?: unknown } | null
  const editorInput = rawState?.editor ?? state
  const bufferedEditorState = createBufferedEditorState(editorInput)
  if (!bufferedEditorState) {
    console.error('RESTORE_BUFFERED_STATE: Invalid editor buffer state.')
    return
  }

  const oldIdToNewId: Record<string, string> = {}
  const tabs: IFileState[] = bufferedEditorState.tabs.map((tab) => {
    const fileState = createDocumentState(tab as unknown as Record<string, unknown>)
    oldIdToNewId[tab.id] = fileState.id
    return fileState
  })

  const currentFileId = bufferedEditorState.currentFileId
    ? oldIdToNewId[bufferedEditorState.currentFileId]
    : undefined
  const currentFile: IFileState | null = tabs.find((tab) => tab.id === currentFileId) ?? null

  const projectStore = useProjectStore()
  const layoutStore = useLayoutStore()

  projectStore.RESTORE_BUFFERED_STATE(rawState?.project)
  layoutStore.RESTORE_BUFFERED_STATE(rawState?.layout)
  store.$patch((s) => {
    s.tabs = tabs
    s.currentFile = currentFile
    s.tabIdToIndex = {}
    s.listToc = []
    s.toc = []
  })

  store.updateTabIdToIndex()
  window.DIRNAME = currentFile?.pathname ? window.path.dirname(currentFile.pathname) : ''
  store.UPDATE_LINE_ENDING_MENU()

  for (const warning of bufferedEditorState.restoreWarnings) {
    const restoredTabId = warning.tabId ? oldIdToNewId[warning.tabId] : null
    const tab = restoredTabId
      ? store.tabs.find((t) => t.id === restoredTabId)
      : store.tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, warning.pathname ?? ''))

    if (!tab) continue

    store.pushTabNotification({
      tabId: tab.id,
      msg: warning.msg,
      showConfirm: warning.showConfirm,
      style: warning.style,
      exclusiveType: warning.exclusiveType
    })
  }
}
