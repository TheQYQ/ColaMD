import bus from '../bus'
import { deepClone } from '../util'
import notice from '../services/notification'
import { t } from '../i18n'
import { useProjectStore } from './project'
import { createDocumentState, getOptionsFromState, getRootFolderFromState } from './help'
import { takeReloadBoundary } from './contentChange'
import { sendBufferedState, debouncedSendBufferedState } from './bufferedState'
import type { FileChangePayload } from './contentEvents'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(17) — reloading a file that changed under us, marking tabs dirty when a
// path disappears, and what the window asks before it closes. Moved out of the
// `actions` object in `editor.ts` line for line (`this.X()` -> `store.X()`), so
// the tab-identity rules inside `loadChange` and the unsaved-files decision in
// the close request are unchanged.

export const applyFileChange = (store: EditorStore, change: FileChangePayload): void => {
  const { tabs, currentFile } = store
  const { data, pathname } = change
  const {
    isMixedLineEndings,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,
    encoding,
    markdown,
    filename
  } = data
  // Create a new document and update few entires later.
  const newFileState = createDocumentState({
    markdown,
    filename,
    pathname,
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline
  })

  const tab = tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, pathname))
  if (!tab) {
    // The tab may be closed in the meanwhile.
    console.error('loadChange: Cannot find tab in tab list.')
    notice.notify({
      title: t('store.editor.errorLoadingTabTitle'),
      message: t('store.editor.errorLoadingTabMessage'),
      type: 'error',
      time: 20000,
      showConfirm: false
    })
    return
  }

  // Backup few entries that we need to restore later.
  const oldId = tab.id
  const oldNotifications = tab.notifications
  // Preserve scroll across external reload so the editor stays put.
  const oldScrollTop = tab.scrollTop
  const oldHistory = takeReloadBoundary(tab.history)

  // Update file content and restore some entries.
  Object.assign(tab, newFileState)
  tab.id = oldId
  tab.notifications = oldNotifications
  tab.scrollTop = oldScrollTop
  if (oldHistory) {
    tab.history = oldHistory
  }

  if (isMixedLineEndings && typeof lineEnding === 'string') {
    store.pushTabNotification({
      tabId: tab.id,
      msg: t('store.editor.mixedLineEndingsNormalized', {
        name: filename,
        lineEnding: lineEnding.toUpperCase()
      }),
      showConfirm: false,
      style: 'info',
      exclusiveType: ''
    })
  }

  // Reload the editor if the tab is currently opened.
  if (currentFile && pathname === currentFile.pathname) {
    // save current state first
    store.currentFile = tab
    const { id, cursor, history, scrollTop, muyaIndexCursor } = tab // Should not use blocks history as this is loaded from disk
    bus.emit('file-changed', {
      id,
      markdown,
      muyaIndexCursor,
      cursor,
      renderCursor: true,
      history,
      scrollTop,
      // External disk reload: the engine handler records the new content as a
      // single invertible undo boundary (replaceContent) instead of clearing
      // history (setContent), so the first undo restores the pre-reload doc.
      isReload: true
    })
  }
  debouncedSendBufferedState()
}

export const setSaveStatusWhenRemove = (
  store: EditorStore,
  { pathname }: { pathname: string }
): void => {
  let didUpdateSaveStatus = false
  store.tabs.forEach((f) => {
    if (f.pathname === pathname) {
      f.isSaved = false
      didUpdateSaveStatus = true
    }
  })
  if (didUpdateSaveStatus) {
    debouncedSendBufferedState()
  }
}

export const listenForClose = (store: EditorStore): void => {
  const projectStore = useProjectStore()
  window.electron.ipcRenderer.on('mt::ask-for-close', () => {
    sendBufferedState()
      .catch((err) => {
        console.error('Failed to update buffered state before closing', err)
      })
      .then(() => {
        const unsavedFiles = store.tabs
          .filter((file) => !file.isSaved)
          .map((file) => {
            const { id, filename, pathname, markdown } = file
            const options = getOptionsFromState(file)
            return {
              id,
              filename,
              pathname,
              markdown,
              options,
              defaultPath: getRootFolderFromState(projectStore)
            }
          })

        // Always prompt before closing with unsaved changes (Typora
        // behavior) — even when start-up action is "restore all", because
        // the user explicitly chooses 保存 / 放弃更改 / 取消 here; the
        // discard path drops the tabs from the session buffer.
        if (unsavedFiles.length) {
          window.electron.ipcRenderer.send('mt::close-window-confirm', deepClone(unsavedFiles))
        } else {
          window.electron.ipcRenderer.send('mt::close-window')
        }
      })
  })
}
