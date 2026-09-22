import type { IFileState } from '@shared/types/files'

// O12(4): the two predicates LISTEN_FOR_CONTENT_CHANGE decides on. Both read only
// the fields they are given, which is what let them leave an action that had grown
// to 44 branches.

/**
 * True when a commit turns a previously empty buffer into a lone newline. The
 * caller still stores the markdown and schedules the buffer write, then returns
 * without touching the caret, history, TOC or saved flag.
 */
export const isNewlineOnlyFromEmpty = (oldMarkdown: string, markdown: string): boolean =>
  oldMarkdown.length === 0 && markdown.length === 1 && markdown[0] === '\n'

/**
 * An external reload replaces the tab's document, so the frame the user was
 * standing on is kept as the single entry of a fresh one-frame history: that is
 * what makes the first undo return the pre-reload document. Everything else is
 * dropped, and the frame is released from the old stack on the way out — the
 * release happens whether or not a frame was found, as before.
 */
export const takeReloadBoundary = (
  history: IFileState['history']
): IFileState['history'] | null => {
  const { index, stack } = history
  // Written as a negation of the old `histIndex >= 0 && stack.length >= 1` so a
  // non-numeric index short-circuits exactly as it did inline, instead of
  // decrementing to NaN and dropping a frame on the way out.
  if (!(index >= 0) || stack.length < 1) return null

  const entry = stack[index]
  const boundary = entry ? { stack: [entry], index: 0 } : null

  history.index--
  history.stack.pop()
  return boundary
}

/**
 * The id of the history frame the editor currently sits on, or undefined when
 * there is none to record — no index, an index past the stack, or a frame whose
 * id is not the numeric form the save tracking uses. `MARK_TAB_SAVED` stores
 * this as `lastSavedHistoryId`, which is what `historyMarksDirty` compares
 * against, so an id of 0 must survive the comparison rather than read as absent.
 */
export const historyFrameId = (history: IFileState['history']): number | undefined => {
  const { stack, lastEditIndex } = history
  if (typeof lastEditIndex !== 'number' || lastEditIndex < 0 || lastEditIndex >= stack.length) {
    return undefined
  }
  const entry = stack[lastEditIndex]
  return entry && typeof entry.id === 'number' ? entry.id : undefined
}

/**
 * Whether the history stack says the tab holds unsaved work.
 *
 * Normally the frame at `lastEditIndex` is compared against the frame that was
 * written to disk (`lastSavedHistoryId`). An undo all the way back leaves
 * `lastEditIndex` at -1 with no frame to compare, so that case is measured
 * against `lastInitIndex` — the frame the document was loaded with.
 */
export const historyMarksDirty = (
  history: IFileState['history'],
  lastSavedHistoryId: IFileState['lastSavedHistoryId']
): boolean => {
  const { stack, lastEditIndex, lastInitIndex } = history
  const editEntry =
    typeof lastEditIndex === 'number' && lastEditIndex >= 0 ? stack[lastEditIndex] : undefined

  return (
    (typeof lastEditIndex === 'number' &&
      lastEditIndex >= 0 &&
      editEntry !== undefined &&
      editEntry.id !== lastSavedHistoryId) ||
    (lastEditIndex === -1 && lastSavedHistoryId !== -1 && lastSavedHistoryId !== lastInitIndex)
  )
}
