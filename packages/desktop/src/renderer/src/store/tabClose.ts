import bus from '../bus'
import { deepClone } from '../util'
import { getOptionsFromState } from './help'
import { createFileChangedEvent, selectTabAfterClose } from './tabOps'
import { clearAutoSaveTimer } from './autoSaveTimer'
import { debouncedSendBufferedState } from './bufferedState'
import type { IFileState } from '@shared/types/files'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(11) — the tab-close cluster, moved out of the 1727-line `actions` object
// in `editor.ts` verbatim. Every action there is now a one-line delegation, so
// the rules below are what the store still does when a tab goes away: the
// dispatch in front (`closeTab`), the two removal paths (`forceCloseTab` for a
// saved tab, `closeUnsavedTab` for one that must be written first), the bulk
// helpers, and `closeTabsByIds` — the batch removal behind "save all" /
// "discard changes" that main drives back through `mt::force-close-tabs-by-id`.
//
// The flush calls are load-bearing and stay commented per site: once a tab is
// spliced, the engine's deferred `json-change` can no longer reach it, so any
// read of its markdown (a snapshot, a save payload, the session buffer) has to
// happen after a flush and before the splice.

/** Close one tab, asking main to save it first when it holds unsaved work. */
export const closeTab = (store: EditorStore, file: IFileState | null = null): void => {
  const target = file ?? store.currentFile
  if (target === null) return

  if (target.isSaved) {
    forceCloseTab(store, target)
  } else {
    closeUnsavedTab(store, target)
  }
}

export const forceCloseTab = (store: EditorStore, file: IFileState): void => {
  // Flush before the tab is removed: the closing tab may be the active
  // one with unflushed engine edits, and once spliced the `json-change`
  // triggered by the flush can no longer reach it (its id is gone from
  // the tab map) — the 'Session End' snapshot below would read stale
  // markdown.
  if (file.id === store.currentFile?.id) {
    store.flushActiveEditor()
  }
  const { tabs, currentFile } = store
  const index = tabs.findIndex((t) => t.id === file.id)
  if (index > -1) {
    tabs.splice(index, 1)
    store.updateTabIdToIndex()
  }

  clearAutoSaveTimer(file.id)

  // Snapshot on close so the user can recover unsaved work from the
  // history panel even if they chose "Don't Save".
  if (file.pathname && !file.isSaved) {
    store.SAVE_VERSION_SNAPSHOT('Session End')
  }

  store.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

  if (currentFile && file.id === currentFile.id) {
    const fileState = selectTabAfterClose(store.tabs, index)
    store.currentFile = fileState
    if (fileState && typeof fileState.markdown === 'string') {
      window.DIRNAME = fileState.pathname ? window.path.dirname(fileState.pathname) : ''
      bus.emit('file-changed', createFileChangedEvent(fileState))
    } else {
      window.DIRNAME = ''
    }
  }

  if (store.tabs.length === 0) {
    store.listToc = []
    store.toc = []
  }

  const { pathname } = file
  if (pathname) {
    window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
  }
  debouncedSendBufferedState()
}

export const closeUnsavedTab = (store: EditorStore, file: IFileState): void => {
  // Save flow: the active tab's markdown lags the live engine until a
  // flush, and once sent the unflushed edits would be silently dropped
  // from the written file.
  if (file.id === store.currentFile?.id) {
    store.flushActiveEditor()
  }
  const { id, pathname, filename, markdown } = file
  const options = getOptionsFromState(file)
  window.electron.ipcRenderer.send('mt::save-and-close-tabs', [
    { id, pathname, filename, markdown, options: deepClone(options) }
  ])
}

export const closeOtherTabs = (store: EditorStore, file: IFileState): void => {
  store.tabs
    .filter((f) => f.id !== file.id)
    .forEach((tab) => {
      closeTab(store, tab)
    })
}

export const closeSavedTabs = (store: EditorStore): void => {
  store.tabs
    .filter((f) => f.isSaved)
    .forEach((tab) => {
      closeTab(store, tab)
    })
}

export const closeAllTabs = (store: EditorStore): void => {
  store.tabs.slice().forEach((tab) => {
    closeTab(store, tab)
  })
}

export const closeTabsByIds = (store: EditorStore, tabIdList: string[]): void => {
  if (!tabIdList || tabIdList.length === 0) return

  let tabIndex = 0
  tabIdList.forEach((id) => {
    const index = store.tabs.findIndex((f) => f.id === id)
    if (index === -1) return

    const closed = store.tabs[index]
    const { pathname } = closed ?? { pathname: '' }

    if (pathname) {
      window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
    }

    store.tabs.splice(index, 1)
    if (store.currentFile?.id === id) {
      store.currentFile = null
      window.DIRNAME = ''
      if (tabIdList.length === 1) {
        tabIndex = index
      }
    }
  })

  store.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

  if (store.currentFile == null && store.tabs.length > 0) {
    store.currentFile = selectTabAfterClose(store.tabs, tabIndex)
    const current = store.currentFile
    if (current && typeof current.markdown === 'string') {
      window.DIRNAME = current.pathname ? window.path.dirname(current.pathname) : ''
      bus.emit('file-changed', createFileChangedEvent(current))
    }
  }

  if (store.tabs.length === 0) {
    store.listToc = []
    store.toc = []
  }
  debouncedSendBufferedState()
}
