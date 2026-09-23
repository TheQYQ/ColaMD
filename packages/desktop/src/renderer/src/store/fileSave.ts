import bus from '../bus'
import { deepClone } from '../util'
import notice from '../services/notification'
import { t } from '../i18n'
import { useProjectStore } from './project'
import { getOptionsFromState, getRootFolderFromState } from './help'
import { historyFrameId } from './contentChange'
import { debouncedSendBufferedState } from './bufferedState'
import type { IFileState } from '@shared/types/files'
import type { IpcMainEventChannels } from '@shared/types/ipc'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(12) — the save round trip and the rename paths, moved out of the
// `actions` object in `editor.ts` verbatim (the store keeps one-line
// delegations). What changed on the way out is only the duplication: `FILE_SAVE`
// and `FILE_SAVE_AS` were the same eighteen lines with a different channel
// name, so both now build their request through `sendSaveRequest` — the case in
// `test/unit/specs/tab-save-and-pathname.spec.ts` that asserts the two
// requests are field-for-field equal is what makes that safe.

/** The "this tab has never been written to disk, so saving it *is* the answer
 * to Move-to / Rename" request. */
const sendSaveForUntitledFile = (tab: IFileState, defaultPath: string): void => {
  window.electron.ipcRenderer.send(
    'mt::response-file-save',
    tab.id,
    tab.filename,
    tab.pathname,
    tab.markdown,
    deepClone(getOptionsFromState(tab)),
    defaultPath
  )
}

const sendSaveRequest = (
  store: EditorStore,
  channel: 'mt::response-file-save' | 'mt::response-file-save-as'
): void => {
  const tab = store.currentFile
  if (!tab) return
  // Flush first: the active tab's markdown lags the engine's deferred
  // `json-change`, so an edit made in the same frame as Cmd+S would otherwise
  // be dropped from the written file (#3803).
  store.flushActiveEditor()
  const projectStore = useProjectStore()
  const { id, filename, pathname, markdown } = tab
  const options = getOptionsFromState(tab)
  const defaultPath = getRootFolderFromState(projectStore)

  if (id) {
    store.SAVE_VERSION_SNAPSHOT('Manual Save')
    window.electron.ipcRenderer.send(
      channel,
      id,
      filename,
      pathname,
      markdown,
      deepClone(options),
      defaultPath
    )
  }
}

export const saveFile = (store: EditorStore): void => {
  sendSaveRequest(store, 'mt::response-file-save')
}

export const saveFileAs = (store: EditorStore): void => {
  sendSaveRequest(store, 'mt::response-file-save-as')
}

/**
 * A tab acquired a real path (save-as or a dialog save). A tab already open
 * on that path is closed first, since two tabs on one file would fight over
 * it; the surviving tab keeps its id so undo and watchers stay attached.
 */
export const setPathname = (
  store: EditorStore,
  fileInfo: IpcMainEventChannels['mt::set-pathname'][0]
): void => {
  const { tabs } = store
  const { pathname, id, filename } = fileInfo
  const tab = tabs.find((f) => f.id === id)
  if (!tab) {
    console.error('[ERROR] Cannot change file path from unknown tab.')
    return
  }

  const existingTab = tabs.find(
    (t) => t.id !== id && window.fileUtils.isSamePathSync(t.pathname, pathname)
  )
  if (existingTab) {
    store.CLOSE_TAB(existingTab)
  }

  if (id === store.currentFile?.id && pathname) {
    window.DIRNAME = window.path.dirname(pathname)
  }
  Object.assign(tab, { filename, pathname, isSaved: true })
  debouncedSendBufferedState()
}

/**
 * Main finished writing the tab. Remember which history frame that was: the
 * saved flag is re-derived from it later, so an undo back to this exact
 * content clears the dot again without comparing text.
 */
export const markTabSaved = (store: EditorStore, tabId: string): void => {
  const tab = store.tabs.find((f) => f.id === tabId)
  if (!tab) return

  const frameId = historyFrameId(tab.history)
  if (frameId !== undefined) {
    tab.lastSavedHistoryId = frameId
  }
  tab.isSaved = true
  debouncedSendBufferedState()
}

export const tabSaveFailure = (store: EditorStore, tabId: string, msg: string): void => {
  const tab = store.tabs.find((t) => t.id === tabId)
  if (!tab) {
    notice.notify({
      title: t('dialog.saveFailure'),
      message: msg,
      type: 'error',
      time: 20000,
      showConfirm: false
    })
    return
  }

  tab.isSaved = false
  store.pushTabNotification({
    tabId,
    msg: t('store.editor.errorWhileSaving', { msg }),
    style: 'crit'
  })
  debouncedSendBufferedState()
}

export const moveFileTo = (store: EditorStore): void => {
  if (!store.currentFile) return
  store.flushActiveEditor()
  const { id, pathname } = store.currentFile
  if (!id) return
  if (!pathname) {
    // A newly created file has nowhere to move to — saving it is the answer.
    sendSaveForUntitledFile(store.currentFile, getRootFolderFromState(useProjectStore()))
  } else {
    window.electron.ipcRenderer.send('mt::response-file-move-to', { id, pathname })
  }
}

export const responseForRename = (store: EditorStore): void => {
  if (!store.currentFile) return
  store.flushActiveEditor()
  const { id, pathname } = store.currentFile
  if (!id) return
  if (!pathname) {
    // Same reasoning as MOVE_FILE_TO: an unsaved tab is saved, not renamed.
    sendSaveForUntitledFile(store.currentFile, getRootFolderFromState(useProjectStore()))
  } else {
    bus.emit('rename')
  }
}

/** Ask main process to rename this file to a new name `newFilename`. */
export const rename = (store: EditorStore, newFilename: string): void => {
  if (!store.currentFile) return
  const { id, pathname, filename } = store.currentFile
  if (typeof filename === 'string' && filename !== newFilename) {
    const newPathname = window.path.join(window.path.dirname(pathname), newFilename)
    window.electron.ipcRenderer.send('mt::rename', {
      id,
      pathname,
      newPathname,
      currentFile: deepClone(store.currentFile)
    })
  }
}

/**
 * Update the pathname/filename of any tab whose pathname matches `src`.
 * Invoked from the sidebar rename flow (project.ts:RENAME_IN_SIDEBAR).
 */
export const renameIfNeeded = (
  store: EditorStore,
  { src, dest }: { src: string; dest: string }
): void => {
  store.tabs.forEach((tab) => {
    if (tab.pathname === src) {
      tab.pathname = dest
      tab.filename = window.path.basename(dest)
    }
  })
  // Keep DIRNAME in sync when the active tab is the one being renamed,
  // so link resolution / dirname-based lookups don't keep using the old
  // folder until the user switches tabs.
  if (store.currentFile != null && store.currentFile.pathname === dest) {
    window.DIRNAME = window.path.dirname(dest)
  }
  debouncedSendBufferedState()
}
