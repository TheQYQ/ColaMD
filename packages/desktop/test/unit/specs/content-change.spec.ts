import { describe, expect, it } from 'vitest'
import type { IFileState } from '@shared/types/files'
import { historyMarksDirty, isNewlineOnlyFromEmpty } from '@/store/contentChange'

// O12(4) — the two predicates LISTEN_FOR_CONTENT_CHANGE decides on, pinned outside
// the action so the dirty rule (which is what decides whether a save is owed) has
// a name and a case for each of its branches.

const history = (over: Partial<IFileState['history']> = {}): IFileState['history'] =>
  ({ stack: [{ id: 1 }, { id: 2 }, { id: 3 }], index: 0, ...over }) as IFileState['history']

describe('isNewlineOnlyFromEmpty', () => {
  it('matches only an empty buffer becoming a lone newline', () => {
    expect(isNewlineOnlyFromEmpty('', '\n')).toBe(true)
    expect(isNewlineOnlyFromEmpty('', '')).toBe(false)
    expect(isNewlineOnlyFromEmpty('', 'a')).toBe(false)
    expect(isNewlineOnlyFromEmpty('', '\n\n')).toBe(false)
    expect(isNewlineOnlyFromEmpty('', ' \n')).toBe(false)
    expect(isNewlineOnlyFromEmpty('x', '\n')).toBe(false)
  })
})

describe('historyMarksDirty', () => {
  it('compares the current edit frame against the frame last written to disk', () => {
    expect(historyMarksDirty(history({ lastEditIndex: 2 }), 1)).toBe(true)
    expect(historyMarksDirty(history({ lastEditIndex: 2 }), 3)).toBe(false)
  })

  it('treats a saved document with no edit frame as clean', () => {
    expect(historyMarksDirty(history({ lastEditIndex: undefined }), 3)).toBe(false)
    expect(historyMarksDirty(history({ lastEditIndex: -1 }), -1)).toBe(false)
  })

  it('uses the initial frame when an undo walked back past every edit', () => {
    // Edge case from the original comment: with lastEditIndex -1 there is no
    // edit frame to compare, so the load-time frame decides.
    expect(historyMarksDirty(history({ lastEditIndex: -1, lastInitIndex: 9 }), 3)).toBe(true)
    expect(historyMarksDirty(history({ lastEditIndex: -1, lastInitIndex: 3 }), 3)).toBe(false)
  })

  it('is clean rather than throwing when the index points past the stack', () => {
    expect(historyMarksDirty(history({ lastEditIndex: 7 }), 1)).toBe(false)
  })

  it('reports the first edit of a fresh document as dirty', () => {
    // `lastSavedHistoryId` seeds to 0, not undefined (store/help.ts:122).
    expect(historyMarksDirty(history({ lastEditIndex: 0 }), 0)).toBe(true)
    expect(historyMarksDirty(history({ lastEditIndex: 0 }), 1)).toBe(false)
  })
})
