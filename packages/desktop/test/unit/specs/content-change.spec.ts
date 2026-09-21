import { describe, expect, it } from 'vitest'
import type { IFileState } from '@shared/types/files'
import {
  historyFrameId,
  historyMarksDirty,
  isNewlineOnlyFromEmpty,
  takeReloadBoundary
} from '@/store/contentChange'

// O12(4)+(5) — the decisions LISTEN_FOR_CONTENT_CHANGE and the external-reload
// path make, pinned outside the actions so each rule has a name and a case for
// every branch it owns.

const history = (over: Partial<IFileState['history']> = {}): IFileState['history'] =>
  ({ stack: [{ id: 1 }, { id: 2 }, { id: 3 }], index: 0, ...over }) as IFileState['history']

describe('historyFrameId', () => {
  it('reads the frame the editor sits on', () => {
    expect(historyFrameId(history({ lastEditIndex: 2 }))).toBe(3)
    expect(historyFrameId(history({ lastEditIndex: 0 }))).toBe(1)
  })

  it('returns undefined for no frame, a negative index, or one past the stack', () => {
    expect(historyFrameId(history({ lastEditIndex: undefined }))).toBeUndefined()
    expect(historyFrameId(history({ lastEditIndex: -1 }))).toBeUndefined()
    expect(historyFrameId(history({ lastEditIndex: 9 }))).toBeUndefined()
  })

  it('keeps a frame id of 0, which a truthiness check would drop', () => {
    const zeroBased = { stack: [{ id: 0 }], index: 0, lastEditIndex: 0 } as IFileState['history']
    expect(historyFrameId(zeroBased)).toBe(0)
  })

  it('ignores a frame whose id is not the numeric save-tracking form', () => {
    const stringy = { stack: [{ id: 'mu-1' }], index: 0, lastEditIndex: 0 } as IFileState['history']
    expect(historyFrameId(stringy)).toBeUndefined()
  })
})

describe('takeReloadBoundary', () => {
  it('keeps the frame the user stands on and releases the rest', () => {
    const hist = {
      stack: [{ id: 1 }, { id: 2 }, { id: 3 }],
      index: 1
    } as IFileState['history']

    expect(takeReloadBoundary(hist)).toEqual({ stack: [{ id: 2 }], index: 0 })
    expect(hist).toMatchObject({ index: 0, stack: [{ id: 1 }, { id: 2 }] })
  })

  it('returns nothing before the first frame, without touching the stack', () => {
    const hist = { stack: [{ id: 1 }], index: -1 } as IFileState['history']

    expect(takeReloadBoundary(hist)).toBeNull()
    expect(hist).toMatchObject({ index: -1, stack: [{ id: 1 }] })
  })

  it('returns nothing for an empty stack', () => {
    const hist = { stack: [], index: 0 } as IFileState['history']

    expect(takeReloadBoundary(hist)).toBeNull()
    expect(hist.stack).toEqual([])
  })

  it('still releases a slot when the index runs past the stack', () => {
    const hist = { stack: [{ id: 1 }], index: 4 } as IFileState['history']

    expect(takeReloadBoundary(hist)).toBeNull()
    expect(hist).toMatchObject({ index: 3, stack: [] })
  })
})

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
