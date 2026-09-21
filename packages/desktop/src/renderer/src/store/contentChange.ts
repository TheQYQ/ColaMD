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
