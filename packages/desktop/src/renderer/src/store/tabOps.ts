import type { IFileState } from '@shared/types/files'

// O12(3): the rules the tab-lifecycle actions share, kept as functions of their
// arrays so they can be tested without a store, an editor or a bus. None of them
// touches `this`, writes `window.DIRNAME` or sends IPC — that stays with the
// actions. `moveItem` is the one that writes: it reorders the array handed to
// it, which for the store is `this.tabs` itself, exactly as the inline closure
// this replaces did.

/**
 * The tab that becomes current after a close: whoever sits at `preferredIndex`,
 * else the tab just before it, else the first, else none. Both callers pass a
 * list that no longer contains the closed tab; FORCE_CLOSE_TAB passes the slot it
 * vacated, CLOSE_TABS passes the slot it would like to land on (0 unless a lone
 * current tab was closed).
 */
export const selectTabAfterClose = (
  remaining: IFileState[],
  preferredIndex: number
): IFileState | null =>
  remaining[preferredIndex] ?? remaining[preferredIndex - 1] ?? remaining[0] ?? null

/**
 * CYCLE_TABS direction is a boolean: false is left, true is right, and both
 * wrap around the ends.
 */
export const nextCycleIndex = (currentIndex: number, length: number, right: boolean): number => {
  if (right) return (currentIndex + 1) % length
  return currentIndex === 0 ? length - 1 : currentIndex - 1
}

/**
 * Where a dragged tab lands when the drop target is still in the list: the
 * removal already happened, so a target behind the moved tab has shifted one
 * slot earlier. The "no target" branch doesn't call this — it passes
 * `tabs.length - 1` to move the tab to the end.
 */
export const exchangeTargetIndex = (fromIndex: number, toIndex: number): number =>
  fromIndex < toIndex ? toIndex - 1 : toIndex

/**
 * Move one element in place. `from` must be an index that exists — a positive
 * out-of-range one returns false and leaves the array untouched, a negative one
 * does not (splice counts from the end, as the old inline closure also did). A
 * `to` past the end is not an error: splice clamps it, which is how a tab with
 * no drop target ends up last.
 */
export const moveItem = <T>(arr: T[], from: number, to: number): boolean => {
  if (from === to) return true
  const len = arr.length
  const item = arr.splice(from, 1)
  if (item.length === 0) return false

  arr.splice(to, 0, ...item)
  return arr.length === len
}

/** One tab the freshly loaded window should open. */
export interface BootstrapTabRequest {
  markdown?: string
  selected: boolean
}

/**
 * What a window opens on first paint, in priority order: the welcome document
 * (first run only), else a single blank tab, else the markdown strings main
 * handed over — where only the first is selected so the rest land as background
 * tabs. An empty result means the window is restoring a session instead.
 *
 * `welcomeMarkdown` is `unknown` because it reaches the renderer through the
 * bootstrap config's index signature, and it is only read when truthy — as
 * before, `String(...)` never sees the absent case.
 */
export const initialTabsToOpen = ({
  addBlankTab,
  welcomeMarkdown,
  markdownList
}: {
  addBlankTab?: boolean
  welcomeMarkdown?: unknown
  markdownList: string[]
}): BootstrapTabRequest[] => {
  if (welcomeMarkdown) {
    return [{ markdown: String(welcomeMarkdown), selected: true }]
  }
  if (addBlankTab) {
    return [{ selected: true }]
  }
  return markdownList.map((markdown, index) => ({ markdown, selected: index === 0 }))
}

/** The bus payload that (re)loads a tab into the editor. */
interface FileChangedEvent {
  id: string
  markdown: string
  cursor: unknown
  muyaIndexCursor: unknown
  renderCursor: true
  history: IFileState['history']
  scrollTop: number
  blocks: unknown
}

/**
 * Read straight off `file` at call time — so a caller that must emit values
 * captured *before* an intervening side effect (UPDATE_CURRENT_FILE flushes the
 * outgoing editor between the read and the emit) keeps its own destructure.
 */
export const createFileChangedEvent = (file: IFileState): FileChangedEvent => ({
  id: file.id,
  markdown: file.markdown,
  cursor: file.cursor,
  muyaIndexCursor: file.muyaIndexCursor,
  renderCursor: true,
  history: file.history,
  scrollTop: file.scrollTop,
  blocks: file.blocks
})
