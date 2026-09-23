import { deepClone } from '../util'
import { t } from '../i18n'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { adjustTrailingNewlines, getOptionsFromState, getRootFolderFromState } from './help'
import { historyMarksDirty, isNewlineOnlyFromEmpty } from './contentChange'
import { autoSaveTimers, clearAutoSaveTimer } from './autoSaveTimer'
import { debouncedSendBufferedState } from './bufferedState'
import type { IFileState } from '@shared/types/files'
import type { IpcMainEventChannels } from '@shared/types/ipc'
import type { LineEnding } from '@shared/types/files'
import type { TocItem } from './editor'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(13) — the content pipeline: what the engine reports after every change,
// what auto-save does with it, and what happens when the file changes under us
// on disk. Moved out of the `actions` object in `editor.ts` verbatim; the one
// structural change is that the three tiers `LISTEN_FOR_CONTENT_CHANGE` already
// documented for itself (keystroke / derived-UI / full commit) became three
// named functions, which is also what takes it off the top of the complexity
// ranking.

export interface FileChangePayload {
  pathname: string
  data: {
    isMixedLineEndings?: boolean
    lineEnding?: LineEnding | string
    adjustLineEndingOnSave?: boolean
    trimTrailingNewline?: number
    encoding?: IFileState['encoding']
    markdown: string
    filename: string
  }
}

export interface AutoSavePayload {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: ReturnType<typeof getOptionsFromState>
}

export interface ContentChangePayload {
  id: string
  // M1.2b lazy-serialization payload tiers:
  //  - markdown non-null → full content change (serialized snapshot included).
  //  - markdown null + edit true → keystroke-tier notification: the live engine
  //    holds the new content but no serialized snapshot exists yet; only the
  //    cheap dirty/auto-save bookkeeping runs.
  //  - markdown null + edit falsy → derived-UI-state-only update (TOC/blocks).
  markdown: string | null
  edit?: boolean
  wordCount?: IFileState['wordCount'] | null
  cursor?: unknown | null
  muyaIndexCursor?: unknown | null
  history?: IFileState['history'] | null
  toc?: TocItem[] | null
  blocks?: unknown | null
}

/** Re-arm the per-tab auto-save timer for a tab the user just edited. */
const armAutoSave = (store: EditorStore, tab: IFileState, markdown: string): void => {
  const { filename, pathname } = tab
  if (!pathname || !usePreferencesStore().autoSave) return
  store.HANDLE_AUTO_SAVE({
    id: tab.id,
    filename,
    pathname,
    markdown,
    options: getOptionsFromState(tab)
  })
}

const applyKeystrokeTier = (
  store: EditorStore,
  tab: IFileState,
  { cursor, wordCount }: ContentChangePayload
): void => {
  // M1.2b keystroke tier: the engine holds the new content but no
  // serialized snapshot exists yet. Only the cheap, order-sensitive
  // bookkeeping runs: a real user edit is deterministically dirty (the
  // debounced full commit recomputes the content hash and restores
  // cleanliness if an undo landed back on the saved content), and
  // auto-save must re-arm per keystroke.
  if (cursor) tab.cursor = cursor
  if (wordCount) tab.wordCount = wordCount
  tab.isSaved = false
  // The auto-save timer re-reads the active tab's markdown at fire
  // time (flush-on-read), so the possibly-stale snapshot here is fine.
  armAutoSave(store, tab, typeof tab.markdown === 'string' ? tab.markdown : '')
  debouncedSendBufferedState()
}

const applyDerivedTier = (
  store: EditorStore,
  tab: IFileState,
  id: string,
  { wordCount, toc, blocks }: ContentChangePayload
): void => {
  if (blocks) tab.blocks = blocks
  // wordCount rides this debounced tier too (sidebar counter only —
  // see the json-change callback in editor.vue); apply it when present.
  if (wordCount) tab.wordCount = wordCount
  store.refreshTocIfChanged(id, toc)
}

const applyCommitTier = (
  store: EditorStore,
  tab: IFileState,
  id: string,
  payload: ContentChangePayload,
  rawMarkdown: string
): void => {
  const { markdown: oldMarkdown, trimTrailingNewline } = tab
  const { cursor, muyaIndexCursor, history, blocks, toc, wordCount } = payload
  const markdown = adjustTrailingNewlines(rawMarkdown, trimTrailingNewline)

  tab.markdown = markdown

  if (isNewlineOnlyFromEmpty(oldMarkdown, markdown)) {
    debouncedSendBufferedState()
    return
  }

  if (wordCount) tab.wordCount = wordCount
  if (cursor) tab.cursor = cursor
  if (muyaIndexCursor) tab.muyaIndexCursor = muyaIndexCursor
  if (history) tab.history = history
  if (blocks) tab.blocks = blocks

  // Only update TOC if it's the current file
  store.refreshTocIfChanged(id, toc)

  const isDirty =
    history === undefined
      ? markdown !== oldMarkdown
      : historyMarksDirty(tab.history, tab.lastSavedHistoryId)
  if (isDirty) {
    tab.isSaved = false
    armAutoSave(store, tab, markdown)
  } else if (history !== undefined && tab.lastSavedHistoryId !== -1) {
    // Check here is to prevent it from overriding a restored .isSaved state
    tab.isSaved = true // An undo can trigger this
  }
  debouncedSendBufferedState()
}

export const listenForContentChange = (store: EditorStore, payload: ContentChangePayload): void => {
  const { id } = payload
  if (!id) {
    throw new Error('Listen for document change but id was not set!')
  } else if (store.tabs.length === 0) {
    return
  } else if (!(id in store.tabIdToIndex)) {
    // This only happens when the sourceCode tries to write a stale id via prepareTabSwitch() but the tab
    // has already been closed. In this case we can safely ignore the update.
    return
  }

  const tab = store.tabs[store.tabIdToIndex[id]]
  if (!tab) return

  // M1.2b lazy serialization: the three tiers below are ordered by cost, and
  // which one runs is decided by what the engine actually sent.
  if (payload.edit === true) {
    applyKeystrokeTier(store, tab, payload)
    return
  }
  if (payload.markdown === null) {
    applyDerivedTier(store, tab, id, payload)
    return
  }
  applyCommitTier(store, tab, id, payload, payload.markdown)
}

export const handleAutoSave = (store: EditorStore, payload: AutoSavePayload): void => {
  const { id, filename, pathname, markdown, options } = payload
  if (!id || !pathname) {
    throw new Error('HANDLE_AUTO_SAVE: Invalid tab.')
  }

  const projectStore = useProjectStore()
  const { autoSaveDelay } = usePreferencesStore()

  clearAutoSaveTimer(id)

  const timer = setTimeout(() => {
    autoSaveTimers.delete(id)

    const tab = store.tabs.find((t) => t.id === id)
    if (tab && !tab.isSaved) {
      // `markdown` was captured when the timer was scheduled; the active
      // tab's newest content lives in the engine (still unflushed edits
      // would be silently dropped from the written file). Flush and
      // re-read so the auto-save persists the content as of NOW.
      let markdownToSave = markdown
      if (tab.id === store.currentFile?.id) {
        store.flushActiveEditor()
        markdownToSave = tab.markdown
      }
      store.SAVE_VERSION_SNAPSHOT('Auto-save')
      const defaultPath = getRootFolderFromState(projectStore)
      window.electron.ipcRenderer.send(
        'mt::response-file-save',
        id,
        filename,
        pathname,
        markdownToSave,
        deepClone(options),
        defaultPath
      )
    }
  }, autoSaveDelay)
  autoSaveTimers.set(id, timer)
}

export const handleDiskChange = (
  store: EditorStore,
  payload: IpcMainEventChannels['mt::update-file'][0]
): void => {
  const preferencesStore = usePreferencesStore()
  const { type, change } = payload
  const { tabs } = store
  const { pathname } = change
  const tab = tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, pathname))
  if (!tab) {
    console.error(`HANDLE_DISK_CHANGE: Cannot find tab for path "${pathname}".`)
    return
  }

  const { id, isSaved, filename } = tab
  switch (type) {
    case 'unlink': {
      tab.isSaved = false
      store.pushTabNotification({
        tabId: id,
        msg: t('store.editor.fileRemovedOnDisk', { name: filename }),
        style: 'warn',
        showConfirm: false,
        exclusiveType: 'file_changed'
      })
      debouncedSendBufferedState()
      break
    }
    case 'add':
    case 'change': {
      // Flush the active tab first: its `tab.markdown` lags the live
      // engine until a flush, and comparing against a stale value
      // would falsely report a content change and warn/reload (#1861).
      if (tab.id === store.currentFile?.id) {
        store.flushActiveEditor()
      }
      // Only the file's metadata changed on disk (e.g. a git checkout
      // that left the content byte-identical) — there is nothing to
      // reload and no reason to warn the user (#1861).
      const newMarkdown = (change as unknown as FileChangePayload).data?.markdown
      if (typeof newMarkdown === 'string' && newMarkdown === tab.markdown) {
        break
      }

      const { autoSave } = preferencesStore
      if (autoSave) {
        clearAutoSaveTimer(id)

        if (isSaved) {
          store.loadChange(change as unknown as FileChangePayload)
          return
        }
      }

      tab.isSaved = false
      store.pushTabNotification({
        tabId: id,
        msg: t('store.editor.fileChangedOnDisk', { name: filename }),
        showConfirm: true,
        exclusiveType: 'file_changed',
        action: (status) => {
          if (status) {
            store.loadChange(change as unknown as FileChangePayload)
          }
        }
      })
      debouncedSendBufferedState()
      break
    }
    default:
      console.error(`HANDLE_DISK_CHANGE: Invalid type "${type}"`)
  }
}
