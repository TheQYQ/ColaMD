import listToTree from '../util/listToTree'
import {
  createApplicationMenuState,
  createSelectionFormatState,
  type SelectionChange,
  type SelectionFormat
} from '../services/applicationMenuState'
import type { TocItem } from './editor'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(19) — the outline mirrors and the selection side of the editor store:
// what the sidebar TOC holds, the caret a tab re-activates with, and the format
// state the native (and self-drawn) menu tracks. Moved out of the `actions`
// object in `editor.ts` line for line (`this.X()` -> `store.X()`); `tocSignature`
// came along because `maybeRefreshToc` is its only caller.

const tocSignature = (toc: TocItem[]): string =>
  toc.map((item) => `${item.lvl ?? ''}:${item.githubSlug ?? ''}:${item.content ?? ''}`).join('|')

export const updateTocState = (store: EditorStore, toc: TocItem[]): void => {
  store.listToc = toc ?? []
  store.toc = listToTree<TocItem>(toc ?? [])
}

/**
 * PERFORMANCE: both content-change tiers guard this with the cheap
 * `lvl:githubSlug:content` signature (see `tocSignature` above) before
 * rebuilding, because most typing keystrokes touch no heading and the tree
 * rebuild is not free. Unlike `updateTocState` this refreshes only the tab on
 * screen, and only when the signature actually moved.
 */
export const maybeRefreshToc = (
  store: EditorStore,
  id: string,
  toc: TocItem[] | null | undefined
): void => {
  if (id === store.currentFile?.id && toc && tocSignature(toc) !== tocSignature(store.listToc)) {
    store.listToc = toc
    store.toc = listToTree<TocItem>(toc)
  }
}

// Content change from the realtime preview editor and the source-code editor.
// It can fire AFTER the tab was switched, hence the identity checks below.
export const selectionChange = (store: EditorStore, changes: SelectionChange): void => {
  const { start, end } = changes
  if (store.currentFile && start.key === end.key && start.block?.text) {
    const value = start.block.text.substring(start.offset, end.offset)
    store.currentFile.searchMatches = {
      matches: [],
      index: -1,
      value
    }
  }

  const menuState = createApplicationMenuState(changes)
  store.selectionMenuState = menuState
  const { windowId } = window.colamd?.env ?? { windowId: -1 }
  window.electron.ipcRenderer.send('mt::editor-selection-changed', windowId, menuState)
}

// Persist the caret for a tab without the heavy content-change pipeline: a pure
// caret move (click / arrow key) fires `selection-change` but NOT `json-change`, so
// `tab.cursor` would otherwise only ever track the last EDIT. Lightweight by design:
// it stores the serialized caret and skips the markdown/blocks/TOC re-derivation.
export const persistCursor = (store: EditorStore, id: string, cursor: unknown): void => {
  if (!id || !cursor) return
  const index = store.tabIdToIndex[id]
  if (index == null) return
  const tab = store.tabs[index]
  if (tab) tab.cursor = cursor
}

export const selectionFormats = (store: EditorStore, formats: SelectionFormat[]): void => {
  const formatState = createSelectionFormatState(formats)
  store.selectionFormatState = formatState
  const { windowId } = window.colamd?.env ?? { windowId: -1 }
  window.electron.ipcRenderer.send('mt::update-format-menu', windowId, formatState)
}
