import listToTree from '../util/listToTree'
import {
  createApplicationMenuState,
  createSelectionFormatState,
  type ApplicationMenuState,
  type SelectionChange,
  type SelectionFormat
} from '../services/applicationMenuState'
import type { TocItem } from './editor'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// PERF-03 (#GUI-B3): `selection-change` fires on every click, arrow key and
// drag-select tick, and each of the two IPC sends makes the main process
// rewrite every item of a native menu. While the caret moves inside one block
// the derived states are nearly always identical, so an unchanged state is not
// sent at all. Keyed by window id — two editor windows alternate events, and
// one window's "unchanged" says nothing about the other's.
const lastMenuStateByWindow = new Map<number, ApplicationMenuState>()
const lastFormatStateByWindow = new Map<number, Record<string, boolean>>()

/**
 * Drop the "last state sent" cache for a window. The main process mutates the
 * two menus OUTSIDE this channel too (`mt::set-editor-format-menus-enabled`
 * greys them out in source-code mode), so the cache's invariant "the menus
 * mirror the last state we sent" breaks there — the caller must invalidate
 * right after sending it, or the state re-application on exiting source mode
 * would be skipped as "unchanged" and the menus would stay greyed out.
 */
export const invalidateSelectionMenuCache = (windowId: number): void => {
  lastMenuStateByWindow.delete(windowId)
  lastFormatStateByWindow.delete(windowId)
}

const shallowEqualRecords = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

// The menu state nests the affiliation record, so a flat compare will not do.
// `createApplicationMenuState` builds the object (and the record) in a fixed
// order from the same engine payload shape, which makes the fingerprint stable
// for identical consecutive events. The state is a handful of primitives —
// stringifying it is far cheaper than the IPC + native menu rewrite it saves.
const sameMenuState = (a: ApplicationMenuState, b: ApplicationMenuState): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

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
    // Same hot path: skip the reactive write when the selected text did not
    // change (plain caret movement keeps producing the empty selection).
    if (store.currentFile.searchMatches.value !== value) {
      store.currentFile.searchMatches = {
        matches: [],
        index: -1,
        value
      }
    }
  }

  const { windowId } = window.colamd?.env ?? { windowId: -1 }
  const menuState = createApplicationMenuState(changes)
  const lastMenuState = lastMenuStateByWindow.get(windowId)
  if (lastMenuState && sameMenuState(lastMenuState, menuState)) return
  lastMenuStateByWindow.set(windowId, menuState)
  store.selectionMenuState = menuState
  window.electron.ipcRenderer.send('mt::editor-selection-changed', windowId, menuState)
}

// Persist the caret for a tab without the heavy content-change pipeline: a pure
// caret move (click / arrow key) fires `selection-change` but NOT `json-change`, so
// `tab.cursor` would otherwise only ever track the last EDIT. Lightweight by design:
// it stores the serialized caret and skips the markdown/TOC re-derivation.
export const persistCursor = (store: EditorStore, id: string, cursor: unknown): void => {
  if (!id || !cursor) return
  const index = store.tabIdToIndex[id]
  if (index == null) return
  const tab = store.tabs[index]
  if (tab) tab.cursor = cursor
}

export const selectionFormats = (store: EditorStore, formats: SelectionFormat[]): void => {
  const { windowId } = window.colamd?.env ?? { windowId: -1 }
  const formatState = createSelectionFormatState(formats)
  const lastFormatState = lastFormatStateByWindow.get(windowId)
  if (lastFormatState && shallowEqualRecords(lastFormatState, formatState)) return
  lastFormatStateByWindow.set(windowId, formatState)
  store.selectionFormatState = formatState
  window.electron.ipcRenderer.send('mt::update-format-menu', windowId, formatState)
}
