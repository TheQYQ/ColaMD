import bus, { listenBoth } from '../bus'
import { getUniqueId, deepClone } from '../util'
import { byteLengthUtf8 } from '../util/byteLengthUtf8'
import {
  moveFileTo,
  markTabSaved,
  rename,
  renameIfNeeded,
  responseForRename,
  saveFile,
  saveFileAs,
  setPathname,
  tabSaveFailure
} from './fileSave'
import listToTree, { type ListItem, type TreeNode } from '../util/listToTree'
import {
  createDocumentState,
  getOptionsFromState,
  createBufferedEditorState,
  getRootFolderFromState
} from './help'
import notice from '../services/notification'
import {
  createApplicationMenuState,
  createSelectionFormatState,
  type ApplicationMenuState,
  type SelectionChange,
  type SelectionFormat
} from '../services/applicationMenuState'
import { takeReloadBoundary } from './contentChange'
import { applyBootstrapEditor, restoreBufferedEditorState } from './windowSession'
import {
  cycleTabs,
  exchangeTabsById,
  newTabWithContent,
  newUntitledTab,
  showTabView,
  switchTabByFilepath,
  switchTabByIndex
} from './tabLifecycle'
import {
  handleAutoSave,
  handleDiskChange,
  listenForContentChange,
  type AutoSavePayload,
  type ContentChangePayload,
  type FileChangePayload
} from './contentEvents'
import {
  FileEncodingCommand,
  LineEndingCommand,
  QuickOpenCommand,
  TrailingNewlineCommand
} from '../commands'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { t } from '../i18n'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import {
  closeAllTabs,
  closeOtherTabs,
  closeSavedTabs,
  closeTab,
  closeTabsByIds,
  closeUnsavedTab,
  forceCloseTab
} from './tabClose'
import {
  isImageUnreferenced,
  resolveCleanupCandidate,
  type CleanupCandidate
} from '../util/imageCleanup'
import type { FormatLinkPayload, IpcMainEventChannels, VersionSnapshot } from '@shared/types/ipc'
import type {
  BootstrapEditorConfig,
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

// The payload shape is owned by the shared contract: `mt::format-link-click`
// crosses to the main process, and both ends now check against one declaration.
type FormatLinkClickPayload = FormatLinkPayload

interface ExportPayload {
  type: string
  content?: string
  /** Binary export payloads (e.g. .docx bytes) — written as-is by main. */
  bytes?: Uint8Array
  /** Raw markdown source — used by the pandoc export formats. */
  markdown?: string
  pageOptions?: PageOptions
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
      restoreBufferedEditorState(this, state)
    },

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
      saveFile(this)
    },

    // need pass some data to main process when `save` menu item clicked
    LISTEN_FOR_SAVE(): void {
      listenBoth('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
    },

    FILE_SAVE_AS(): void {
      saveFileAs(this)
    },

    // need pass some data to main process when `save as` menu item clicked
    LISTEN_FOR_SAVE_AS(): void {
      listenBoth('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
    },

    SET_PATHNAME(fileInfo: IpcMainEventChannels['mt::set-pathname'][0]): void {
      setPathname(this, fileInfo)
    },

    MARK_TAB_SAVED(tabId: string): void {
      markTabSaved(this, tabId)
    },

    TAB_SAVE_FAILURE(tabId: string, msg: string): void {
      tabSaveFailure(this, tabId, msg)
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
      moveFileTo(this)
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
      responseForRename(this)
    },

    RENAME(newFilename: string): void {
      rename(this, newFilename)
    },

    RENAME_IF_NEEDED({ src, dest }: { src: string; dest: string }): void {
      renameIfNeeded(this, { src, dest })
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
    /**
     * The first message from a freshly loaded window: fold the launch config into
     * the other stores, then open whatever tabs it asks for. Kept apart from the
     * registration below so the sequence can be driven from a test.
     */
    APPLY_BOOTSTRAP_EDITOR(config: BootstrapEditorConfig): void {
      applyBootstrapEditor(this, config)
    },

    LISTEN_FOR_BOOTSTRAP_WINDOW(): void {
      const projectStore = useProjectStore()
      const preferencesStore = usePreferencesStore()

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
        this.APPLY_BOOTSTRAP_EDITOR(config)
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
      closeTab(this, file)
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
      forceCloseTab(this, file)
    },

    CLOSE_UNSAVED_TAB(file: IFileState): void {
      closeUnsavedTab(this, file)
    },

    CLOSE_OTHER_TABS(file: IFileState): void {
      closeOtherTabs(this, file)
    },

    CLOSE_SAVED_TABS(): void {
      closeSavedTabs(this)
    },

    CLOSE_ALL_TABS(): void {
      closeAllTabs(this)
    },

    CLOSE_TABS(tabIdList: string[]): void {
      closeTabsByIds(this, tabIdList)
    },

    EXCHANGE_TABS_BY_ID(tabIDs: { fromId: string; toId: string | null }): void {
      exchangeTabsById(this, tabIDs)
    },

    RENAME_FILE(file: IFileState): void {
      this.UPDATE_CURRENT_FILE(file)
      bus.emit('rename')
    },

    // Direction is a boolean where false is left and true right.
    CYCLE_TABS(direction: boolean): void {
      cycleTabs(this, direction)
    },

    SWITCH_TAB_BY_FILEPATH(filePath: string): void {
      switchTabByFilepath(this, filePath)
    },

    SWITCH_TAB_BY_INDEX(nextTabIndex: number): void {
      switchTabByIndex(this, nextTabIndex)
    },

    NEW_UNTITLED_TAB({
      markdown: markdownString,
      selected
    }: {
      markdown?: string
      selected?: boolean
    }): void {
      newUntitledTab(this, { markdown: markdownString, selected })
    },

    NEW_TAB_WITH_CONTENT({
      markdownDocument,
      options = {},
      selected
    }: {
      markdownDocument: MarkdownDocument | null | undefined
      options?: TabOptions
      selected?: boolean
    }): void {
      newTabWithContent(this, { markdownDocument, options, selected })
    },

    SHOW_TAB_VIEW(always: boolean): void {
      showTabView(this, always)
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
    LISTEN_FOR_CONTENT_CHANGE(payload: ContentChangePayload): void {
      listenForContentChange(this, payload)
    },

    HANDLE_AUTO_SAVE(payload: AutoSavePayload): void {
      handleAutoSave(this, payload)
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
      handleDiskChange(this, payload)
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
