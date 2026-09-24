import bus from '../bus'
import { t } from '../i18n'
import { usePreferencesStore } from './preferences'
import { useLayoutStore } from './layout'
import { createDocumentState, getBlankFileState } from './help'
import { exchangeTargetIndex, moveItem, nextCycleIndex } from './tabOps'
import { debouncedSendBufferedState } from './bufferedState'
import type { MarkdownDocument, TabOptions } from '@shared/types/files'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(14) — opening, activating and reordering tabs, moved out of the
// `actions` object in `editor.ts` verbatim (the store keeps one-line
// delegations). The pure rules behind it already lived in `tabOps.ts`
// (`nextCycleIndex`, `exchangeTargetIndex`, `moveItem`); what is here is the
// state side: which tab becomes current, what the id index owes after a move,
// and when the tab bar is shown.

export const exchangeTabsById = (
  store: EditorStore,
  tabIDs: { fromId: string; toId: string | null }
): void => {
  const { fromId, toId } = tabIDs
  const { tabs } = store

  const fromIndex = tabs.findIndex((t) => t.id === fromId)
  if (fromIndex === -1) return

  if (!toId) {
    moveItem(tabs, fromIndex, tabs.length - 1)
  } else {
    const toIndex = tabs.findIndex((t) => t.id === toId)
    if (toIndex === -1) return
    moveItem(tabs, fromIndex, exchangeTargetIndex(fromIndex, toIndex))
  }
  store.updateTabIdToIndex()
  debouncedSendBufferedState()
}

// Direction is a boolean where false is left and true right.
export const cycleTabs = (store: EditorStore, direction: boolean): void => {
  const { tabs, currentFile } = store
  if (tabs.length <= 1) {
    return
  }

  const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
  if (currentIndex === -1) {
    console.error('CYCLE_TABS: Cannot find current tab index.')
    return
  }

  const nextTabIndex = nextCycleIndex(currentIndex, tabs.length, direction)

  const nextTab = tabs[nextTabIndex]
  if (!nextTab || !nextTab.id) {
    console.error(`CYCLE_TABS: Cannot find next tab (index="${nextTabIndex}").`)
    return
  }

  store.UPDATE_CURRENT_FILE(nextTab)
}

export const switchTabByFilepath = (store: EditorStore, filePath: string): void => {
  const { tabs } = store

  if (!filePath) {
    console.warn('Invalid file path:', filePath)
    return
  }

  const nextTabIndex = tabs.findIndex((t) => t.pathname === filePath)
  if (nextTabIndex === -1) {
    console.error('Cannot find tab with pathname:', filePath)
    return
  }
  const next = tabs[nextTabIndex]
  if (next) store.UPDATE_CURRENT_FILE(next)
}

export const switchTabByIndex = (store: EditorStore, nextTabIndex: number): void => {
  const { tabs, currentFile } = store
  if (nextTabIndex < 0 || nextTabIndex >= tabs.length) {
    console.warn('Invalid tab index:', nextTabIndex)
    return
  }

  const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
  if (currentIndex === -1) {
    console.error('Cannot find current tab index.')
    return
  }

  const nextTab = tabs[nextTabIndex]
  if (!nextTab || !nextTab.id) {
    console.error(`Cannot find tab by index="${nextTabIndex}".`)
    return
  }
  store.UPDATE_CURRENT_FILE(nextTab)
}

/** Show the tab bar when asked to, or when the window is down to one tab. */
export const showTabView = (store: EditorStore, always: boolean): void => {
  const { tabs } = store
  const layoutStore = useLayoutStore()
  if (always || tabs.length === 1) {
    layoutStore.SET_LAYOUT({ showTabBar: true })
    layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
  }
}

/**
 * Create a new untitled tab, optionally seeded with markdown content.
 */
export const newUntitledTab = (
  store: EditorStore,
  { markdown: markdownString, selected }: { markdown?: string; selected?: boolean }
): void => {
  if (selected == null) {
    selected = true
  }

  store.SHOW_TAB_VIEW(false)

  const preferencesStore = usePreferencesStore()
  const { defaultEncoding, endOfLine } = preferencesStore
  const fileState = getBlankFileState(
    store.tabs,
    defaultEncoding,
    endOfLine,
    markdownString ?? null
  )

  if (selected) {
    const { id, markdown } = fileState
    store.UPDATE_CURRENT_FILE(fileState)
    bus.emit('file-loaded', { id, markdown })
  } else {
    store.tabs.push(fileState)
    store.updateTabIdToIndex()
    debouncedSendBufferedState()
  }
}

export const newTabWithContent = (
  store: EditorStore,
  {
    markdownDocument,
    options = {},
    selected
  }: {
    markdownDocument: MarkdownDocument | null | undefined
    options?: TabOptions
    selected?: boolean
  }
): void => {
  if (!markdownDocument) {
    console.warn('Cannot create a file tab without a markdown document!')
    store.NEW_UNTITLED_TAB({})
    return
  }

  if (typeof selected === 'undefined') {
    selected = true
  }

  const { currentFile, tabs } = store
  const { pathname } = markdownDocument
  const existingTab = tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, pathname ?? ''))
  if (existingTab) {
    store.UPDATE_CURRENT_FILE(existingTab)
    return
  }

  let keepTabBarState = false
  if (currentFile) {
    const { isSaved, pathname: cfPath } = currentFile
    if (isSaved && !cfPath) {
      keepTabBarState = true
      store.FORCE_CLOSE_TAB(currentFile)
    }
  }

  if (!keepTabBarState) {
    store.SHOW_TAB_VIEW(false)
  }

  const { markdown, isMixedLineEndings } = markdownDocument
  const docState = createDocumentState(
    Object.assign(
      {},
      markdownDocument as unknown as Record<string, unknown>,
      options as Record<string, unknown>
    )
  )
  const { id, cursor } = docState

  if (selected) {
    store.UPDATE_CURRENT_FILE(docState)
    bus.emit('file-loaded', { id, markdown, cursor })
  } else {
    store.tabs.push(docState)
    store.updateTabIdToIndex()
    debouncedSendBufferedState()
  }

  if (isMixedLineEndings) {
    const { filename, lineEnding } = markdownDocument
    if (typeof lineEnding === 'string') {
      store.pushTabNotification({
        tabId: id,
        msg: t('store.editor.mixedLineEndingsNormalized', {
          name: filename,
          lineEnding: lineEnding.toUpperCase()
        })
      })
    }
  }
}
