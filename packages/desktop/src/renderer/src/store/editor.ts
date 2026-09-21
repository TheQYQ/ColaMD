import bus, { listenBoth } from '../bus'
import { getUniqueId, deepClone } from '../util'
import { byteLengthUtf8 } from '../util/byteLengthUtf8'
import listToTree, { type ListItem, type TreeNode } from '../util/listToTree'
import {
  createDocumentState,
  getOptionsFromState,
  getBlankFileState,
  adjustTrailingNewlines,
  createBufferedEditorState
} from './help'
import notice from '../services/notification'
import {
  createApplicationMenuState,
  createSelectionFormatState,
  type ApplicationMenuState,
  type SelectionChange,
  type SelectionFormat
} from '../services/applicationMenuState'
import {
  createFileChangedEvent,
  exchangeTargetIndex,
  moveItem,
  nextCycleIndex,
  selectTabAfterClose
} from './tabOps'
import { historyFrameId, historyMarksDirty, isNewlineOnlyFromEmpty } from './contentChange'
import {
  FileEncodingCommand,
  LineEndingCommand,
  QuickOpenCommand,
  TrailingNewlineCommand
} from '../commands'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { useMainStore } from '.'
import { t } from '../i18n'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import {
  isImageUnreferenced,
  resolveCleanupCandidate,
  type CleanupCandidate
} from '../util/imageCleanup'
import type { IpcMainEventChannels, VersionSnapshot } from '@shared/types/ipc'
import type {
  IFileState,
  FileNotification,
  LineEnding,
  MarkdownDocument,
  PageOptions,
  TabOptions
} from '@shared/types/files'

// ----------------------------------------------------------------------------
// Local helper types
// ----------------------------------------------------------------------------

export interface TocItem extends ListItem {
  slug?: string
  githubSlug?: string
  content?: string
  lvl: number | null
}

type TocTreeNode = TreeNode<TocItem>

// PERFORMANCE: Cheap signature for TOC comparison — O(n) string concat used to
// short-circuit the expensive deep comparison and `listToTree()` rebuild.
//
// The signature must cover everything that determines the rendered tree: each
// heading's level, its content-derived `githubSlug` and its text.
//
// `githubSlug` also seeds el-tree's `node-key`, so it decides which
// expand/collapse state survives (#3028). The key itself is `deriveKeyedToc`'s
// deduped `githubSlug` -- duplicate headings get `-1`, `-2`, ... -- so the raw
// `githubSlug` used here is a lower bound on what the tree actually keys on.
//
// Keying on `slug` alone was a real bug: `slug` is a per-render object id
// (`mu-N`) that stays IDENTICAL when a heading's text changes, so an edit that
// only renames a heading produced `inSig === curSig`, the update was silently
// dropped, and the sidebar TOC never refreshed even though the document itself
// had. (Verified: getTOC() returned content "C2"/githubSlug "c2" while the
// signature still read `2:mu-7`.)
const tocSignature = (toc: TocItem[]): string =>
  toc.map((item) => `${item.lvl ?? ''}:${item.githubSlug ?? ''}:${item.content ?? ''}`).join('|')

interface PushTabNotificationPayload {
  tabId: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
  action?: FileNotification['action']
}

interface FileChangePayload {
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

interface FormatLinkClickPayload {
  // muya's getLinkInfo yields `href: null` when the rendered link carries no
  // usable href (e.g. an unsupported protocol stripped by sanitizeHyperlink).
  data: { href: string | null; [key: string]: unknown }
  dirname: string
}

interface ExportPayload {
  type: string
  content?: string
  /** Binary export payloads (e.g. .docx bytes) — written as-is by main. */
  bytes?: Uint8Array
  /** Raw markdown source — used by the pandoc export formats. */
  markdown?: string
  pageOptions?: PageOptions
}

interface AutoSavePayload {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: ReturnType<typeof getOptionsFromState>
}

interface ContentChangePayload {
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

interface ProjectStoreLike {
  projectTree: { pathname?: string } | null
}

// ----------------------------------------------------------------------------
// State shape
// ----------------------------------------------------------------------------

export interface EditorState {
  currentFile: IFileState | null
  tabs: IFileState[]
  tabIdToIndex: Record<string, number>
  listToc: TocItem[]
  toc: TocTreeNode[]
  // Mirrors of the state pushed to the (native) application menu, consumed by
  // the frameless HTML menu bar to resolve checked/disabled items locally.
  selectionMenuState: ApplicationMenuState | null
  selectionFormatState: Record<string, boolean>
}

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Drop a tab's pending auto-save. Three paths need it — the tab closed, a newer
 * edit re-arms it, or the disk version takes over — and in all three a timer left
 * armed would write content the user has already moved past.
 */
const clearAutoSaveTimer = (id: string | undefined): void => {
  if (!id) return
  const timer = autoSaveTimers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  autoSaveTimers.delete(id)
}

// Pending unreferenced-image cleanup checks, keyed by absolute path. The
// delay gives undo (or a cut followed by an immediate paste-back) a window to
// restore the reference before the file is unlinked.
const imageCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
const IMAGE_CLEANUP_DELAY_MS = 5000

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    currentFile: null,
    tabs: [],
    tabIdToIndex: {},
    listToc: [], // Used for equal check and for searching for the correct github-slug to jump to
    toc: [],
    selectionMenuState: null,
    selectionFormatState: {}
  }),

  actions: {
    updateTabIdToIndex(): void {
      this.tabIdToIndex = this.tabs.reduce<Record<string, number>>((map, tab, index) => {
        map[tab.id] = index
        return map
      }, {})
    },

    CREATE_BUFFERED_STATE(): ReturnType<typeof createBufferedEditorState> {
      return createBufferedEditorState(this.$state)
    },

    RESTORE_BUFFERED_STATE(state: unknown): void {
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
      this.$patch((s) => {
        s.tabs = tabs
        s.currentFile = currentFile
        s.tabIdToIndex = {}
        s.listToc = []
        s.toc = []
      })

      this.updateTabIdToIndex()
      window.DIRNAME = currentFile?.pathname ? window.path.dirname(currentFile.pathname) : ''
      this.UPDATE_LINE_ENDING_MENU()

      for (const warning of bufferedEditorState.restoreWarnings) {
        const restoredTabId = warning.tabId ? oldIdToNewId[warning.tabId] : null
        const tab = restoredTabId
          ? this.tabs.find((t) => t.id === restoredTabId)
          : this.tabs.find((t) =>
            window.fileUtils.isSamePathSync(t.pathname, warning.pathname ?? '')
          )

        if (!tab) continue

        this.pushTabNotification({
          tabId: tab.id,
          msg: warning.msg,
          showConfirm: warning.showConfirm,
          style: warning.style,
          exclusiveType: warning.exclusiveType
        })
      }
    },

    /**
     * Copies the specified heading's github-slug to the clipboard.
     * @param key The heading-id to copy.
     */
    copyGithubSlug(key: string): void {
      const item = this.listToc.find((i) => i.slug === key)

      if (item) {
        window.electron.clipboard.writeText(`#${item.githubSlug}`)
        notice.notify({
          title: t('store.editor.anchorLinkCopied'),
          type: 'primary',
          time: 2000,
          showConfirm: false
        })
      } else {
        console.warn(t('store.editor.tocItemNotFound', { key }))
      }
    },

    /**
     * Update scroll position for the currentFile
     */
    updateScrollPosition(id: string, scrollTop: number): void {
      if (!(id in this.tabIdToIndex)) {
        console.warn('updateScrollPosition: Cannot find tab index for id:', id)
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]]
      if (tab) {
        tab.scrollTop = scrollTop
      }
      debouncedSendBufferedState()
    },

    /**
     * Push a tab specific notification on stack that never disappears.
     */
    pushTabNotification(data: PushTabNotificationPayload): void {
      const defaultAction: FileNotification['action'] = () => {}
      const { tabId, msg } = data
      const action = data.action || defaultAction
      const showConfirm = data.showConfirm || false
      const style = data.style || 'info'
      // Whether only one notification should exist.
      const exclusiveType = data.exclusiveType || ''

      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) {
        console.error(t('store.editor.tabNotFound'))
        return
      }

      const { notifications } = tab

      // Remove the old notification if only one should exist.
      if (exclusiveType) {
        const index = notifications.findIndex((n) => n.exclusiveType === exclusiveType)
        if (index >= 0) {
          // Reorder current notification
          notifications.splice(index, 1)
        }
      }

      // Push new notification on stack.
      notifications.push({
        msg,
        showConfirm,
        style,
        exclusiveType,
        action
      })
    },

    loadChange(change: FileChangePayload): void {
      const { tabs, currentFile } = this
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
      let oldHistory: IFileState['history'] | null = null
      const histIndex = tab.history.index
      if (histIndex >= 0 && tab.history.stack.length >= 1) {
        const entry = tab.history.stack[histIndex]
        if (entry) {
          // Allow to restore the old document.
          oldHistory = {
            stack: [entry],
            index: 0
          }
        }

        // Free reference from array
        tab.history.index--
        tab.history.stack.pop()
      }

      // Update file content and restore some entries.
      Object.assign(tab, newFileState)
      tab.id = oldId
      tab.notifications = oldNotifications
      tab.scrollTop = oldScrollTop
      if (oldHistory) {
        tab.history = oldHistory
      }

      if (isMixedLineEndings && typeof lineEnding === 'string') {
        this.pushTabNotification({
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
        this.currentFile = tab
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
    },

    FORMAT_LINK_CLICK({ data, dirname }: FormatLinkClickPayload): void {
      // Check if the link starts with a #, that is a local anchor link.
      if (data.href && data.href[0] === '#') {
        const anchorSlug = data.href.substring(1)
        if (!anchorSlug) return

        // Find the block with the anchor slug from the TOC
        for (const item of this.listToc) {
          if (item.githubSlug === anchorSlug) {
            // Scroll to the corresponding element that matches this github-slug
            bus.emit('scroll-to-header', item.slug)
            return
          }
        }

        // Fall back to a non-heading target: a custom `<a id="...">` (or any
        // element with a matching id) rendered in the document.
        const anchorElement = document.getElementById(anchorSlug)
        if (anchorElement) {
          bus.emit('scroll-to-anchor-element', anchorElement)
        }

        return
      }

      window.electron.ipcRenderer.send('mt::format-link-click', { data, dirname })
    },

    LISTEN_SCREEN_SHOT(): void {
      window.electron.ipcRenderer.on('mt::screenshot-captured', (_, filePath) => {
        bus.emit('screenshot-captured', filePath)
      })
    },

    // image path auto complement
    ASK_FOR_IMAGE_AUTO_PATH(src: string): Promise<string[]> {
      if (!this.currentFile) return Promise.resolve([])
      const { pathname } = this.currentFile
      if (pathname) {
        let rs: (value: string[]) => void = () => {}
        const promise = new Promise<string[]>((resolve) => {
          rs = resolve
        })
        const id = getUniqueId()
        // Dynamic IPC channel — not part of the static IpcMainEventChannels contract.
        ;(
          window.electron.ipcRenderer.once as (
            channel: string,
            listener: (event: unknown, files: string[]) => void
          ) => void
        )(`mt::response-of-image-path-${id}`, (_: unknown, files: string[]) => {
          rs(files)
        })
        window.electron.ipcRenderer.send('mt::ask-for-image-auto-path', {
          pathname,
          src,
          id,
          currentFile: deepClone(this.currentFile)
        })
        return promise
      } else {
        return Promise.resolve([])
      }
    },

    SEARCH(value: IFileState['searchMatches']): void {
      if (!this.currentFile) return
      this.currentFile.searchMatches = deepClone(value) // deep clone to trigger state changes
    },

    // IMG.2: the engine removed the last markdown reference to an image.
    // Schedule a debounced cleanup — the reference check re-runs at fire time
    // so an undo restores cleanliness, and the file is only unlinked when it
    // lives inside the allowed path domain and no open tab references it.
    IMAGE_DELETED({ src }: { src: string }): void {
      const preferencesStore = usePreferencesStore()
      if (!preferencesStore.deleteUnreferencedImages) return
      const tab = this.currentFile
      if (!tab?.pathname) return

      const documentDir = window.path.dirname(tab.pathname)
      const candidate = resolveCleanupCandidate(
        src,
        documentDir,
        preferencesStore.imageFolderPath,
        {
          path: window.path,
          isChildOfDirectory: window.fileUtils.isChildOfDirectory
        }
      )
      if (!candidate) return

      const existing = imageCleanupTimers.get(candidate.absolutePath)
      if (existing) clearTimeout(existing)
      imageCleanupTimers.set(
        candidate.absolutePath,
        setTimeout(() => {
          imageCleanupTimers.delete(candidate.absolutePath)
          this.CLEANUP_UNREFERENCED_IMAGE(candidate).catch((err) => {
            console.error('Image cleanup failed:', err)
          })
        }, IMAGE_CLEANUP_DELAY_MS)
      )
    },

    async CLEANUP_UNREFERENCED_IMAGE(candidate: CleanupCandidate): Promise<void> {
      try {
        // The active tab's markdown may lag the engine (M1.2b lazy pipeline);
        // inactive tabs' markdown is static. Flush so the check sees the
        // post-deletion content.
        this.flushActiveEditor()
        const markdowns = this.tabs.map((t) => (typeof t.markdown === 'string' ? t.markdown : ''))
        if (!isImageUnreferenced(markdowns, candidate)) return
        if (!(await window.fileUtils.pathExists(candidate.absolutePath))) return
        await window.fileUtils.unlink(candidate.absolutePath)
        notice.notify({
          title: t('store.editor.imageCleanupTitle'),
          message: t('store.editor.imageCleanupMessage', {
            name: window.path.basename(candidate.absolutePath)
          }),
          showConfirm: false,
          time: 8000
        })
      } catch (err) {
        console.error('Failed to clean up unreferenced image:', err)
      }
    },

    // We need to update line endings menu when changing tabs.
    UPDATE_LINE_ENDING_MENU(): void {
      if (!this.currentFile) return
      const { lineEnding } = this.currentFile
      if (lineEnding) {
        const { windowId } = window.colamd?.env ?? { windowId: -1 }
        window.electron.ipcRenderer.send(
          'mt::update-line-ending-menu',
          windowId,
          lineEnding as LineEnding
        )
      }
    },

    // Flush any edit still queued in the engine's rAF batch into the active
    // tab's `currentFile` before its markdown is read to persist — otherwise an
    // edit made in the same frame as the read is silently dropped from the
    // written file (#3803), the way tab switching already guards (#2938). Safe
    // no-op when nothing is pending.
    flushActiveEditor(): void {
      bus.emit('flush-active-editor')
    },

    FILE_SAVE(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (id) {
        this.SAVE_VERSION_SNAPSHOT('Manual Save')
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      }
    },

    // need pass some data to main process when `save` menu item clicked
    LISTEN_FOR_SAVE(): void {
      listenBoth('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
    },

    FILE_SAVE_AS(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)

      if (id) {
        this.SAVE_VERSION_SNAPSHOT('Manual Save')
        window.electron.ipcRenderer.send(
          'mt::response-file-save-as',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      }
    },

    // need pass some data to main process when `save as` menu item clicked
    LISTEN_FOR_SAVE_AS(): void {
      listenBoth('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
    },

    /**
     * A tab acquired a real path (save-as or a dialog save). A tab already open
     * on that path is closed first, since two tabs on one file would fight over
     * it; the surviving tab keeps its id so undo and watchers stay attached.
     */
    SET_PATHNAME(fileInfo: IpcMainEventChannels['mt::set-pathname'][0]): void {
      const { tabs } = this
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
        this.CLOSE_TAB(existingTab)
      }

      if (id === this.currentFile?.id && pathname) {
        window.DIRNAME = window.path.dirname(pathname)
      }
      Object.assign(tab, { filename, pathname, isSaved: true })
      debouncedSendBufferedState()
    },

    /**
     * Main finished writing the tab. Remember which history frame that was: the
     * saved flag is re-derived from it later, so an undo back to this exact
     * content clears the dot again without comparing text.
     */
    MARK_TAB_SAVED(tabId: string): void {
      const tab = this.tabs.find((f) => f.id === tabId)
      if (!tab) return

      const frameId = historyFrameId(tab.history)
      if (frameId !== undefined) {
        tab.lastSavedHistoryId = frameId
      }
      tab.isSaved = true
      debouncedSendBufferedState()
    },

    TAB_SAVE_FAILURE(tabId: string, msg: string): void {
      const tab = this.tabs.find((t) => t.id === tabId)
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
      this.pushTabNotification({
        tabId,
        msg: t('store.editor.errorWhileSaving', { msg }),
        style: 'crit'
      })
      debouncedSendBufferedState()
    },

    LISTEN_FOR_SET_PATHNAME(): void {
      window.electron.ipcRenderer.on('mt::set-pathname', (_, fileInfo) => {
        this.SET_PATHNAME(fileInfo)
      })

      window.electron.ipcRenderer.on('mt::tab-saved', (_, tabId) => {
        this.MARK_TAB_SAVED(tabId)
      })

      window.electron.ipcRenderer.on('mt::tab-save-failure', (_, tabId, msg) => {
        this.TAB_SAVE_FAILURE(tabId, msg)
      })
    },

    LISTEN_FOR_CLOSE(): void {
      const projectStore = useProjectStore()
      window.electron.ipcRenderer.on('mt::ask-for-close', () => {
        sendBufferedState()
          .catch((err) => {
            console.error('Failed to update buffered state before closing', err)
          })
          .then(() => {
            const unsavedFiles = this.tabs
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
    },

    LISTEN_FOR_SAVE_CLOSE(): void {
      window.electron.ipcRenderer.on('mt::force-close-tabs-by-id', (_, tabIdList) => {
        if (Array.isArray(tabIdList) && tabIdList.length) {
          this.CLOSE_TABS(tabIdList)
        }
      })
      // "Discard changes" on window close: remove the unsaved tabs, flush the
      // session buffer without them (so a discarded document is not restored
      // on the next launch), then close the window.
      window.electron.ipcRenderer.on('mt::discard-unsaved-tabs-and-close', (_, tabIdList) => {
        if (Array.isArray(tabIdList) && tabIdList.length) {
          this.CLOSE_TABS(tabIdList)
        }
        sendBufferedState()
          .catch((err) => {
            console.error('Failed to flush buffered state after discarding tabs', err)
          })
          .finally(() => {
            window.electron.ipcRenderer.send('mt::close-window')
          })
      })
    },

    ASK_FOR_SAVE_ALL(closeTabs: boolean): void {
      // Only the active tab has a live engine and its `markdown` lags the
      // engine until a flush — flush once so the active tab's content is
      // current before the unsaved filter and save payloads read it.
      this.flushActiveEditor()
      const { tabs } = this
      const projectStore = useProjectStore()
      const unsavedFiles = tabs
        .filter((file) => !(file.isSaved && /[^\n]/.test(file.markdown)))
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

      if (closeTabs) {
        if (unsavedFiles.length) {
          this.CLOSE_TABS(tabs.filter((f) => f.isSaved).map((f) => f.id))
          window.electron.ipcRenderer.send('mt::save-and-close-tabs', deepClone(unsavedFiles))
        } else {
          this.CLOSE_TABS(tabs.map((f) => f.id))
        }
      } else {
        window.electron.ipcRenderer.send('mt::save-tabs', deepClone(unsavedFiles))
      }
    },

    MOVE_FILE_TO(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (!id) return
      if (!pathname) {
        // if current file is a newly created file, just save it!
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      } else {
        // if not, move to a new(maybe) folder
        window.electron.ipcRenderer.send('mt::response-file-move-to', { id, pathname })
      }
    },

    LISTEN_FOR_MOVE_TO(): void {
      listenBoth('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
    },

    LISTEN_FOR_RENAME(): void {
      listenBoth('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
    },

    RESPONSE_FOR_RENAME(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const projectStore = useProjectStore()
      const { id, filename, pathname, markdown } = this.currentFile
      const options = getOptionsFromState(this.currentFile)
      const defaultPath = getRootFolderFromState(projectStore)
      if (!id) return
      if (!pathname) {
        // if current file is a newly created file, just save it!
        window.electron.ipcRenderer.send(
          'mt::response-file-save',
          id,
          filename,
          pathname,
          markdown,
          deepClone(options),
          defaultPath
        )
      } else {
        bus.emit('rename')
      }
    },

    // ask for main process to rename this file to a new name `newFilename`
    RENAME(newFilename: string): void {
      if (!this.currentFile) return
      const { id, pathname, filename } = this.currentFile
      if (typeof filename === 'string' && filename !== newFilename) {
        const newPathname = window.path.join(window.path.dirname(pathname), newFilename)
        window.electron.ipcRenderer.send('mt::rename', {
          id,
          pathname,
          newPathname,
          currentFile: deepClone(this.currentFile)
        })
      }
    },

    /**
     * Update the pathname/filename of any tab whose pathname matches `src`.
     * Invoked from the sidebar rename flow (project.ts:RENAME_IN_SIDEBAR).
     */
    RENAME_IF_NEEDED({ src, dest }: { src: string; dest: string }): void {
      this.tabs.forEach((tab) => {
        if (tab.pathname === src) {
          tab.pathname = dest
          tab.filename = window.path.basename(dest)
        }
      })
      // Keep DIRNAME in sync when the active tab is the one being renamed,
      // so link resolution / dirname-based lookups don't keep using the old
      // folder until the user switches tabs.
      if (this.currentFile != null && this.currentFile.pathname === dest) {
        window.DIRNAME = window.path.dirname(dest)
      }
      debouncedSendBufferedState()
    },

    UPDATE_CURRENT_FILE(currentFile: IFileState): void {
      const oldCurrentFile = this.currentFile
      let didUpdateCurrentFile = false
      if (oldCurrentFile == null || oldCurrentFile.id !== currentFile.id) {
        const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } =
          currentFile
        // Must run while `currentFile` still points at the outgoing tab, so its
        // flushed edit is attributed to that tab and not lost on switch (#2938).
        if (oldCurrentFile) {
          this.flushActiveEditor()
        }
        window.DIRNAME = pathname ? window.path.dirname(pathname) : ''
        this.currentFile = currentFile
        didUpdateCurrentFile = true

        if (!this.tabs.some((file) => file.id === currentFile.id)) {
          this.tabs.push(currentFile)
          this.updateTabIdToIndex()
        }

        bus.emit('file-changed', {
          id,
          markdown,
          cursor,
          muyaIndexCursor,
          renderCursor: true,
          history,
          scrollTop,
          blocks
        })
      }

      this.UPDATE_LINE_ENDING_MENU()
      if (didUpdateCurrentFile) {
        debouncedSendBufferedState()
      }
    },

    // This events are only used during window creation.
    LISTEN_FOR_BOOTSTRAP_WINDOW(): void {
      const preferencesStore = usePreferencesStore()
      const layoutStore = useLayoutStore()
      const projectStore = useProjectStore()
      const mainStore = useMainStore()

      // Delay load runtime commands and initialize commands.
      setTimeout(() => {
        bus.emit('cmd::register-command', new FileEncodingCommand(this))
        bus.emit(
          'cmd::register-command',
          new QuickOpenCommand({
            editor: this,
            preferences: preferencesStore,
            project: projectStore
          })
        )
        bus.emit('cmd::register-command', new LineEndingCommand(this))
        bus.emit('cmd::register-command', new TrailingNewlineCommand(this))

        setTimeout(() => {
          window.electron.ipcRenderer.send('mt::request-keybindings')
          bus.emit('cmd::sort-commands')
        }, 100)
      }, 400)

      window.electron.ipcRenderer.on('mt::bootstrap-editor', (_, config) => {
        const {
          addBlankTab,
          welcomeMarkdown,
          markdownList,
          lineEnding,
          sideBarVisibility,
          tabBarVisibility,
          sourceCodeModeEnabled
        } = config

        mainStore.SET_INITIALIZED()
        preferencesStore.SET_USER_PREFERENCE({ endOfLine: lineEnding })
        layoutStore.SET_LAYOUT({
          rightColumn: 'files',
          showSideBar: !!sideBarVisibility,
          showTabBar: !!tabBarVisibility
        })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
        preferencesStore.SET_MODE({
          type: 'sourceCode',
          checked: !!sourceCodeModeEnabled
        })

        if (welcomeMarkdown) {
          this.NEW_UNTITLED_TAB({ markdown: String(welcomeMarkdown), selected: true })
        } else if (addBlankTab) {
          this.NEW_UNTITLED_TAB({ selected: true })
        } else if (markdownList.length) {
          let isFirst = true
          for (const md of markdownList) {
            this.NEW_UNTITLED_TAB({
              markdown: md,
              selected: isFirst
            })
            isFirst = false
          }
        }
      })
    },

    // Open a new tab, optionally with content.
    LISTEN_FOR_NEW_TAB(): void {
      window.electron.ipcRenderer.on(
        'mt::open-new-tab',
        (_, markdownDocument, options = {}, selected = true) => {
          if (markdownDocument) {
            // Create tab with content.
            this.NEW_TAB_WITH_CONTENT({ markdownDocument, options, selected })
          } else {
            // Fallback: create a blank tab and always select it
            this.NEW_UNTITLED_TAB({})
          }
        }
      )

      window.electron.ipcRenderer.on(
        'mt::new-untitled-tab',
        (_, selected = true, markdown = '') => {
          // Create a blank tab
          this.NEW_UNTITLED_TAB({ markdown, selected })
        }
      )
      bus.on('mt::new-untitled-tab', (payload) => {
        const { selected = true, markdown = '' } =
          (payload as { selected?: boolean; markdown?: string } | undefined) ?? {}
        this.NEW_UNTITLED_TAB({ markdown, selected })
      })
    },

    CLOSE_TAB(file: IFileState | null = null): void {
      const target = file ?? this.currentFile
      if (target === null) return

      if (target.isSaved) {
        this.FORCE_CLOSE_TAB(target)
      } else {
        this.CLOSE_UNSAVED_TAB(target)
      }
    },

    LISTEN_FOR_CLOSE_TAB(): void {
      listenBoth('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
    },

    LISTEN_FOR_TAB_CYCLE(): void {
      listenBoth('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      listenBoth('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
    },

    LISTEN_FOR_SWITCH_TABS(): void {
      window.electron.ipcRenderer.on('mt::switch-tab-by-index', (_, index) => {
        this.SWITCH_TAB_BY_INDEX(index)
      })
      window.electron.ipcRenderer.on('mt::switch-tab-by-file_path', (_, filePath) => {
        this.SWITCH_TAB_BY_FILEPATH(filePath)
      })
    },

    FORCE_CLOSE_TAB(file: IFileState): void {
      // Flush before the tab is removed: the closing tab may be the active
      // one with unflushed engine edits, and once spliced the `json-change`
      // triggered by the flush can no longer reach it (its id is gone from
      // the tab map) — the 'Session End' snapshot below would read stale
      // markdown.
      if (file.id === this.currentFile?.id) {
        this.flushActiveEditor()
      }
      const { tabs, currentFile } = this
      const index = tabs.findIndex((t) => t.id === file.id)
      if (index > -1) {
        tabs.splice(index, 1)
        this.updateTabIdToIndex()
      }

      clearAutoSaveTimer(file.id)

      // Snapshot on close so the user can recover unsaved work from the
      // history panel even if they chose "Don't Save".
      if (file.pathname && !file.isSaved) {
        this.SAVE_VERSION_SNAPSHOT('Session End')
      }

      this.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

      if (currentFile && file.id === currentFile.id) {
        const fileState = selectTabAfterClose(this.tabs, index)
        this.currentFile = fileState
        if (fileState && typeof fileState.markdown === 'string') {
          window.DIRNAME = fileState.pathname ? window.path.dirname(fileState.pathname) : ''
          bus.emit('file-changed', createFileChangedEvent(fileState))
        } else {
          window.DIRNAME = ''
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }

      const { pathname } = file
      if (pathname) {
        window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
      }
      debouncedSendBufferedState()
    },

    CLOSE_UNSAVED_TAB(file: IFileState): void {
      // Save flow: the active tab's markdown lags the live engine until a
      // flush, and once sent the unflushed edits would be silently dropped
      // from the written file.
      if (file.id === this.currentFile?.id) {
        this.flushActiveEditor()
      }
      const { id, pathname, filename, markdown } = file
      const options = getOptionsFromState(file)
      window.electron.ipcRenderer.send('mt::save-and-close-tabs', [
        { id, pathname, filename, markdown, options: deepClone(options) }
      ])
    },

    CLOSE_OTHER_TABS(file: IFileState): void {
      this.tabs
        .filter((f) => f.id !== file.id)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_SAVED_TABS(): void {
      this.tabs
        .filter((f) => f.isSaved)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_ALL_TABS(): void {
      this.tabs.slice().forEach((tab) => {
        this.CLOSE_TAB(tab)
      })
    },

    CLOSE_TABS(tabIdList: string[]): void {
      if (!tabIdList || tabIdList.length === 0) return

      let tabIndex = 0
      tabIdList.forEach((id) => {
        const index = this.tabs.findIndex((f) => f.id === id)
        if (index === -1) return

        const closed = this.tabs[index]
        const { pathname } = closed ?? { pathname: '' }

        if (pathname) {
          window.electron.ipcRenderer.send('mt::window-tab-closed', pathname)
        }

        this.tabs.splice(index, 1)
        if (this.currentFile?.id === id) {
          this.currentFile = null
          window.DIRNAME = ''
          if (tabIdList.length === 1) {
            tabIndex = index
          }
        }
      })

      this.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

      if (this.currentFile == null && this.tabs.length > 0) {
        this.currentFile = selectTabAfterClose(this.tabs, tabIndex)
        const current = this.currentFile
        if (current && typeof current.markdown === 'string') {
          window.DIRNAME = current.pathname ? window.path.dirname(current.pathname) : ''
          bus.emit('file-changed', createFileChangedEvent(current))
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }
      debouncedSendBufferedState()
    },

    EXCHANGE_TABS_BY_ID(tabIDs: { fromId: string; toId: string | null }): void {
      const { fromId, toId } = tabIDs
      const { tabs } = this

      const fromIndex = tabs.findIndex((t) => t.id === fromId)
      if (fromIndex === -1) return

      if (!toId) {
        moveItem(tabs, fromIndex, tabs.length - 1)
      } else {
        const toIndex = tabs.findIndex((t) => t.id === toId)
        if (toIndex === -1) return
        moveItem(tabs, fromIndex, exchangeTargetIndex(fromIndex, toIndex))
      }
      this.updateTabIdToIndex()
      debouncedSendBufferedState()
    },

    RENAME_FILE(file: IFileState): void {
      this.UPDATE_CURRENT_FILE(file)
      bus.emit('rename')
    },

    // Direction is a boolean where false is left and true right.
    CYCLE_TABS(direction: boolean): void {
      const { tabs, currentFile } = this
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

      this.UPDATE_CURRENT_FILE(nextTab)
    },

    SWITCH_TAB_BY_FILEPATH(filePath: string): void {
      const { tabs } = this

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
      if (next) this.UPDATE_CURRENT_FILE(next)
    },

    SWITCH_TAB_BY_INDEX(nextTabIndex: number): void {
      const { tabs, currentFile } = this
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
      this.UPDATE_CURRENT_FILE(nextTab)
    },

    /**
     * Create a new untitled tab, optionally seeded with markdown content.
     */
    NEW_UNTITLED_TAB({
      markdown: markdownString,
      selected
    }: {
      markdown?: string
      selected?: boolean
    }): void {
      if (selected == null) {
        selected = true
      }

      this.SHOW_TAB_VIEW(false)

      const preferencesStore = usePreferencesStore()
      const { defaultEncoding, endOfLine } = preferencesStore
      const fileState = getBlankFileState(
        this.tabs,
        defaultEncoding,
        endOfLine,
        markdownString ?? null
      )

      if (selected) {
        const { id, markdown } = fileState
        this.UPDATE_CURRENT_FILE(fileState)
        bus.emit('file-loaded', { id, markdown })
      } else {
        this.tabs.push(fileState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }
    },

    /**
     * Create a new tab from the given markdown document.
     */
    NEW_TAB_WITH_CONTENT({
      markdownDocument,
      options = {},
      selected
    }: {
      markdownDocument: MarkdownDocument | null | undefined
      options?: TabOptions
      selected?: boolean
    }): void {
      if (!markdownDocument) {
        console.warn('Cannot create a file tab without a markdown document!')
        this.NEW_UNTITLED_TAB({})
        return
      }

      if (typeof selected === 'undefined') {
        selected = true
      }

      const { currentFile, tabs } = this
      const { pathname } = markdownDocument
      const existingTab = tabs.find((t) =>
        window.fileUtils.isSamePathSync(t.pathname, pathname ?? '')
      )
      if (existingTab) {
        this.UPDATE_CURRENT_FILE(existingTab)
        return
      }

      let keepTabBarState = false
      if (currentFile) {
        const { isSaved, pathname: cfPath } = currentFile
        if (isSaved && !cfPath) {
          keepTabBarState = true
          this.FORCE_CLOSE_TAB(currentFile)
        }
      }

      if (!keepTabBarState) {
        this.SHOW_TAB_VIEW(false)
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
        this.UPDATE_CURRENT_FILE(docState)
        bus.emit('file-loaded', { id, markdown, cursor })
      } else {
        this.tabs.push(docState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }

      if (isMixedLineEndings) {
        const { filename, lineEnding } = markdownDocument
        if (typeof lineEnding === 'string') {
          this.pushTabNotification({
            tabId: id,
            msg: t('store.editor.mixedLineEndingsNormalized', {
              name: filename,
              lineEnding: lineEnding.toUpperCase()
            })
          })
        }
      }
    },

    SHOW_TAB_VIEW(always: boolean): void {
      const { tabs } = this
      const layoutStore = useLayoutStore()
      if (always || tabs.length === 1) {
        layoutStore.SET_LAYOUT({ showTabBar: true })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
      }
    },

    SET_SAVE_STATUS_WHEN_REMOVE({ pathname }: { pathname: string }): void {
      let didUpdateSaveStatus = false
      this.tabs.forEach((f) => {
        if (f.pathname === pathname) {
          f.isSaved = false
          didUpdateSaveStatus = true
        }
      })
      if (didUpdateSaveStatus) {
        debouncedSendBufferedState()
      }
    },

    /**
     * Replaces the table of contents with a fresh snapshot from the engine.
     *
     * Used on file load and tab switch, where the engine fires no `json-change`
     * event (so `LISTEN_FOR_CONTENT_CHANGE` never runs and the TOC would
     * otherwise stay empty until the first edit). Assigns unconditionally: this
     * is a re-seed on load/switch, so there is no `equal` guard to short-circuit
     * — the incoming snapshot always wins, even if it happens to deep-equal the
     * current TOC.
     * @param toc Flat list of headings returned by `muya.getTOC()`.
     */
    UPDATE_TOC(toc: TocItem[]): void {
      this.listToc = toc ?? []
      this.toc = listToTree<TocItem>(toc ?? [])
    },

    /**
     * PERFORMANCE: both content-change tiers guarded this with the cheap
     * `lvl:githubSlug:content` signature (see `tocSignature` above) before
     * rebuilding, because most typing keystrokes touch no heading and the tree
     * rebuild is not free. Unlike UPDATE_TOC this refreshes only the tab on
     * screen, and only when the signature actually moved.
     */
    refreshTocIfChanged(id: string, toc: TocItem[] | null | undefined): void {
      if (id === this.currentFile?.id && toc && tocSignature(toc) !== tocSignature(this.listToc)) {
        this.listToc = toc
        this.toc = listToTree<TocItem>(toc)
      }
    },

    // Content change from realtime preview editor and source code editor
    // There is a chance that this event is fired AFTER the tab is switched.
    //
    // PERFORMANCE: Supports two update tiers via nullable fields:
    //   - Critical path: markdown/history/cursor/wordCount are non-null — drives
    //     save/dirty tracking and auto-save.
    //   - Derived UI state: only toc/blocks are non-null — updates sidebar
    //     rendering. When markdown is null, the critical-path bookkeeping is
    //     skipped entirely.
    LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      edit,
      wordCount,
      cursor,
      muyaIndexCursor,
      history,
      toc,
      blocks
    }: ContentChangePayload): void {
      if (!id) {
        throw new Error('Listen for document change but id was not set!')
      } else if (this.tabs.length === 0) {
        return
      } else if (!(id in this.tabIdToIndex)) {
        // This only happens when the sourceCode tries to write a stale id via prepareTabSwitch() but the tab
        // has already been closed. In this case we can safely ignore the update.
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]]
      if (!tab) return

      const preferencesStore = usePreferencesStore()
      const { autoSave } = preferencesStore

      // M1.2b keystroke tier: the engine holds the new content but no
      // serialized snapshot exists yet. Only the cheap, order-sensitive
      // bookkeeping runs: a real user edit is deterministically dirty (the
      // debounced full commit recomputes the content hash and restores
      // cleanliness if an undo landed back on the saved content), and
      // auto-save must re-arm per keystroke.
      if (edit === true) {
        if (cursor) tab.cursor = cursor
        if (wordCount) tab.wordCount = wordCount
        tab.isSaved = false
        const { filename, pathname } = tab
        if (pathname && autoSave) {
          const options = getOptionsFromState(tab)
          // The auto-save timer re-reads the active tab's markdown at fire
          // time (flush-on-read), so the possibly-stale snapshot here is fine.
          this.HANDLE_AUTO_SAVE({
            id,
            filename,
            pathname,
            markdown: typeof tab.markdown === 'string' ? tab.markdown : '',
            options
          })
        }
        debouncedSendBufferedState()
        return
      }

      // Derived UI state only update (debounced TOC/blocks refresh)
      if (markdown === null) {
        if (blocks) tab.blocks = blocks
        // wordCount rides this debounced tier too (sidebar counter only —
        // see the json-change callback in editor.vue); apply it when present.
        if (wordCount) tab.wordCount = wordCount
        this.refreshTocIfChanged(id, toc)
        return
      }

      const { filename, pathname, markdown: oldMarkdown, trimTrailingNewline } = tab

      markdown = adjustTrailingNewlines(markdown, trimTrailingNewline)
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
      this.refreshTocIfChanged(id, toc)

      const isDirty =
        history === undefined
          ? markdown !== oldMarkdown
          : historyMarksDirty(tab.history, tab.lastSavedHistoryId)
      if (isDirty) {
        tab.isSaved = false
        if (pathname && autoSave) {
          const options = getOptionsFromState(tab)
          this.HANDLE_AUTO_SAVE({
            id,
            filename,
            pathname,
            markdown,
            options
          })
        }
      } else if (history !== undefined && tab.lastSavedHistoryId !== -1) {
        // Check here is to prevent it from overriding a restored .isSaved state
        tab.isSaved = true // An undo can trigger this
      }
      debouncedSendBufferedState()
    },

    HANDLE_AUTO_SAVE({ id, filename, pathname, markdown, options }: AutoSavePayload): void {
      if (!id || !pathname) {
        throw new Error('HANDLE_AUTO_SAVE: Invalid tab.')
      }

      const preferencesStore = usePreferencesStore()
      const projectStore = useProjectStore()
      const { autoSaveDelay } = preferencesStore

      clearAutoSaveTimer(id)

      const timer = setTimeout(() => {
        autoSaveTimers.delete(id)

        const tab = this.tabs.find((t) => t.id === id)
        if (tab && !tab.isSaved) {
          // `markdown` was captured when the timer was scheduled; the active
          // tab's newest content lives in the engine (still unflushed edits
          // would be silently dropped from the written file). Flush and
          // re-read so the auto-save persists the content as of NOW.
          let markdownToSave = markdown
          if (tab.id === this.currentFile?.id) {
            this.flushActiveEditor()
            markdownToSave = tab.markdown
          }
          this.SAVE_VERSION_SNAPSHOT('Auto-save')
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
    },

    SELECTION_CHANGE(changes: SelectionChange): void {
      const { start, end } = changes
      if (this.currentFile && start.key === end.key && start.block?.text) {
        const value = start.block.text.substring(start.offset, end.offset)
        this.currentFile.searchMatches = {
          matches: [],
          index: -1,
          value
        }
      }

      const menuState = createApplicationMenuState(changes)
      this.selectionMenuState = menuState
      const { windowId } = window.colamd?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send('mt::editor-selection-changed', windowId, menuState)
    },

    // Persist the caret for a tab without the heavy content-change pipeline. A
    // pure caret move (click / arrow key) fires `selection-change` but NOT
    // `json-change`, so `tab.cursor` — the position replayed when the tab is
    // re-activated — would otherwise only ever track the last EDIT, losing a
    // click-moved caret across an in-session tab switch. Lightweight by design:
    // it only stores the serialized caret, skipping markdown/blocks/TOC re-derivation
    // and the save/dirty bookkeeping LISTEN_FOR_CONTENT_CHANGE performs.
    PERSIST_CURSOR(id: string, cursor: unknown): void {
      if (!id || !cursor) return
      const index = this.tabIdToIndex[id]
      if (index == null) return
      const tab = this.tabs[index]
      if (tab) tab.cursor = cursor
    },

    SELECTION_FORMATS(formats: SelectionFormat[]): void {
      const formatState = createSelectionFormatState(formats)
      this.selectionFormatState = formatState
      const { windowId } = window.colamd?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send('mt::update-format-menu', windowId, formatState)
    },

    EXPORT({ type, content, bytes, markdown, pageOptions }: ExportPayload): void {
      if (this.currentFile === null) return

      let title = ''
      const { listToc } = this
      if (listToc && listToc.length > 0) {
        let headerRef: TocItem | undefined = listToc[0]
        const len = Math.min(listToc.length, 6)
        for (let i = 1; i < len; ++i) {
          if (headerRef?.lvl === 1) break
          const header = listToc[i]
          if (header && headerRef && (headerRef.lvl ?? 0) > (header.lvl ?? 0)) {
            headerRef = header
          }
        }
        title = headerRef?.content ?? ''
      }

      const { filename, pathname } = this.currentFile
      window.electron.ipcRenderer.send('mt::response-export', {
        type: type as ExportPayload['type'] as never,
        title,
        content: content ?? '',
        bytes,
        markdown: markdown ?? '',
        filename,
        pathname,
        pageOptions: pageOptions ?? {}
      })
    },

    LISTEN_FOR_EXPORT_SUCCESS(): void {
      window.electron.ipcRenderer.on('mt::export-success', (_, payload) => {
        const filePath = payload?.filePath ?? ''
        notice
          .notify({
            title: t('store.editor.exportSuccessTitle'),
            message: t('store.editor.exportSuccessMessage', {
              name: window.path.basename(filePath)
            }),
            showConfirm: true
          })
          .then(() => {
            window.electron.shell.showItemInFolder(filePath)
          })
      })
    },

    PRINT_RESPONSE(): void {
      window.electron.ipcRenderer.send('mt::response-print')
    },

    LISTEN_FOR_PRINT_SERVICE_CLEARUP(): void {
      window.electron.ipcRenderer.on('mt::print-service-clearup', () => {
        bus.emit('print-service-clearup')
      })
    },

    SET_LINE_ENDING(lineEnding: LineEnding | string): void {
      if (!this.currentFile) return
      const { lineEnding: oldLineEnding } = this.currentFile
      if (lineEnding !== oldLineEnding) {
        this.currentFile.lineEnding = lineEnding
        this.currentFile.adjustLineEndingOnSave = lineEnding !== 'lf'
        this.currentFile.isSaved = true
        this.UPDATE_LINE_ENDING_MENU()
        debouncedSendBufferedState()
      }
    },

    LISTEN_FOR_SET_LINE_ENDING(): void {
      listenBoth('mt::set-line-ending', (lineEnding) => {
        this.SET_LINE_ENDING(lineEnding as LineEnding)
      })
    },

    LISTEN_FOR_SET_ENCODING(): void {
      bus.on('mt::set-file-encoding', (encodingName) => {
        if (!this.currentFile) return
        const { encoding } = this.currentFile.encoding
        if (encoding !== encodingName) {
          this.currentFile.encoding.encoding = encodingName as string
          this.currentFile.encoding.isBom = false
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_SET_FINAL_NEWLINE(): void {
      bus.on('mt::set-final-newline', (value) => {
        if (!this.currentFile) return
        const { trimTrailingNewline } = this.currentFile
        if (trimTrailingNewline !== value) {
          this.currentFile.trimTrailingNewline = value as number
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    /**
     * A tab's file moved on disk — deleted, or rewritten by something outside the
     * app (git checkout, an editor, a formatter). Either stay quiet, reload from
     * disk, or ask the user first; the branches below are that decision.
     *
     * `change.data` is `unknown` in the cross-process contract, so the two places
     * that need the loaded-document shape cast it; main fills it from
     * `loadMarkdownFile`.
     */
    HANDLE_DISK_CHANGE(payload: IpcMainEventChannels['mt::update-file'][0]): void {
      const preferencesStore = usePreferencesStore()
      const { type, change } = payload
      const { tabs } = this
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
          this.pushTabNotification({
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
          if (tab.id === this.currentFile?.id) {
            this.flushActiveEditor()
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
              this.loadChange(change as unknown as FileChangePayload)
              return
            }
          }

          tab.isSaved = false
          this.pushTabNotification({
            tabId: id,
            msg: t('store.editor.fileChangedOnDisk', { name: filename }),
            showConfirm: true,
            exclusiveType: 'file_changed',
            action: (status) => {
              if (status) {
                this.loadChange(change as unknown as FileChangePayload)
              }
            }
          })
          debouncedSendBufferedState()
          break
        }
        default:
          console.error(`HANDLE_DISK_CHANGE: Invalid type "${type}"`)
      }
    },

    LISTEN_FOR_FILE_CHANGE(): void {
      window.electron.ipcRenderer.on('mt::update-file', (_, payload) => {
        this.HANDLE_DISK_CHANGE(payload)
      })
    },

    ASK_FOR_IMAGE_PATH(): Promise<string> {
      return window.electron.ipcRenderer.invoke('mt::ask-for-image-path')
    },

    EDIT_ZOOM(zoomFactor: number): void {
      const preferencesStore = usePreferencesStore()
      zoomFactor = Number.parseFloat(zoomFactor.toFixed(3))
      const { zoom } = preferencesStore
      if (zoom !== zoomFactor) {
        preferencesStore.SET_SINGLE_PREFERENCE({ type: 'zoom', value: zoomFactor })
      }
      window.electron.webFrame.setZoomFactor(zoomFactor)
    },

    LISTEN_WINDOW_ZOOM(): void {
      listenBoth('mt::window-zoom', (zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor as number)
      })
    },

    LISTEN_FOR_RELOAD_IMAGES(): void {
      window.electron.ipcRenderer.on('mt::invalidate-image-cache', () => {
        bus.emit('invalidate-image-cache')
      })
    },

    LISTEN_FOR_CONTEXT_MENU(): void {
      // General context menu
      window.electron.ipcRenderer.on('mt::cm-copy-as-rich', () => {
        bus.emit('copyAsRich', 'copyAsRich')
      })
      window.electron.ipcRenderer.on('mt::cm-copy-as-html', () => {
        bus.emit('copyAsHtml', 'copyAsHtml')
      })
      window.electron.ipcRenderer.on('mt::cm-paste-as-plain-text', () => {
        bus.emit('pasteAsPlainText', 'pasteAsPlainText')
      })
      window.electron.ipcRenderer.on('mt::cm-insert-paragraph', (_, location) => {
        bus.emit('insertParagraph', location)
      })

      // Spelling
      window.electron.ipcRenderer.on('mt::spelling-replace-misspelling', (_, info) => {
        bus.emit('replace-misspelling', info)
      })
      window.electron.ipcRenderer.on('mt::spelling-show-switch-language', () => {
        bus.emit('open-command-spellchecker-switch-language')
      })
    },

    LISTEN_FOR_STATE_REPLACE(): void {
      window.electron.ipcRenderer.on('mt::load-state', (_, state) => {
        this.RESTORE_BUFFERED_STATE(state)
      })
    },

    /**
     * Persist a version snapshot of the current document to the main process.
     * Called on save / auto-save / tab close so the user can later browse and
     * restore prior versions from the sidebar history panel.
     *
     * @param label Human-readable reason for this snapshot.
     * @param markdownOverride Optional content to snapshot (defaults to current file markdown).
     */
    SAVE_VERSION_SNAPSHOT(label: string, markdownOverride?: string): void {
      if (!this.currentFile) return
      const { pathname, markdown } = this.currentFile
      if (!pathname) return

      const content = markdownOverride ?? markdown
      const snapshot: VersionSnapshot = {
        id: crypto.randomUUID(),
        pathname,
        timestamp: Date.now(),
        markdown: content,
        label,
        byteLength: byteLengthUtf8(content)
      }

      // Guard for test environments where the preload bridge is not available.
      window.versionHistory?.save(snapshot).catch((err) => {
        console.error('Failed to save version snapshot:', err)
      })
    },

    /**
     * Listen for restore events dispatched by the sidebar history panel and
     * write the restored content back into the active tab.
     */
    LISTEN_FOR_VERSION_RESTORE(): void {
      window.addEventListener('version-history:restore', ((e: CustomEvent) => {
        const { markdown, pathname } = e.detail as { markdown: string; pathname: string }
        if (!this.currentFile || this.currentFile.pathname !== pathname) return

        this.currentFile.markdown = markdown
        this.currentFile.isSaved = false
        bus.emit('file-changed', {
          id: this.currentFile.id,
          markdown,
          cursor: this.currentFile.cursor,
          history: this.currentFile.history,
          scrollTop: this.currentFile.scrollTop,
          muyaIndexCursor: this.currentFile.muyaIndexCursor,
          renderCursor: true,
          isReload: true
        })
        this.SAVE_VERSION_SNAPSHOT('Pre-restore Backup', markdown)
        debouncedSendBufferedState()
      }) as EventListener)
    }
  }
})

// ----------------------------------------------------------------------------

/**
 * Return the opened root folder or an empty string.
 *
 * @param {object} projectStore The project store instance.
 */
const getRootFolderFromState = (projectStore: ProjectStoreLike): string => {
  const openedFolder = projectStore.projectTree
  if (openedFolder) {
    return openedFolder.pathname ?? ''
  }
  return ''
}
