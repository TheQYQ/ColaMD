import { describe, expect, it } from 'vitest'
import type { IFileState } from '@shared/types/files'
import {
  createFileChangedEvent,
  exchangeTargetIndex,
  initialTabsToOpen,
  moveItem,
  nextCycleIndex,
  selectTabAfterClose
} from '@/store/tabOps'

// O12(3) — the tab-lifecycle rules the store's close/switch/reorder actions used
// to inline. Each case below restates what the store did before the extraction,
// so the extraction cannot quietly change which tab survives a close or where a
// dragged tab lands.

const tab = (id: string, over: Partial<IFileState> = {}): IFileState =>
  ({
    id,
    filename: `${id}.md`,
    pathname: `/tmp/${id}.md`,
    markdown: `# ${id}`,
    isSaved: true,
    history: {},
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: null,
    ...over
  }) as IFileState

describe('selectTabAfterClose', () => {
  // The store splices first and then asks, so these lists are already without
  // the closed tab and the index is the slot it left behind.
  it('takes the tab that slid into the closed slot', () => {
    expect(selectTabAfterClose([tab('b'), tab('c')], 0)?.id).toBe('b')
    expect(selectTabAfterClose([tab('a'), tab('c')], 1)?.id).toBe('c')
  })

  it('falls back to the previous tab when the last one closes', () => {
    expect(selectTabAfterClose([tab('a'), tab('b')], 2)?.id).toBe('b')
    expect(selectTabAfterClose([tab('a')], 1)?.id).toBe('a')
  })

  it('returns null for the only tab and for an empty list', () => {
    expect(selectTabAfterClose([], 0)).toBeNull()
    expect(selectTabAfterClose([], 1)).toBeNull()
  })

  it('lands on the first tab for index -1, which is what a missed findIndex passes', () => {
    // FORCE_CLOSE_TAB looks the tab up first and does not bail when the lookup
    // misses, so -1 reaches here with a list that was never spliced.
    expect(selectTabAfterClose([tab('a'), tab('b')], -1)?.id).toBe('a')
  })

  it('never mutates the list it reads', () => {
    const tabs = [tab('a'), tab('b')]
    selectTabAfterClose(tabs, 0)
    expect(tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('nextCycleIndex', () => {
  it('walks right and wraps at the end', () => {
    expect(nextCycleIndex(0, 3, true)).toBe(1)
    expect(nextCycleIndex(2, 3, true)).toBe(0)
  })

  it('walks left and wraps at the start', () => {
    expect(nextCycleIndex(2, 3, false)).toBe(1)
    expect(nextCycleIndex(0, 3, false)).toBe(2)
  })

  it('stays put with a single tab', () => {
    expect(nextCycleIndex(0, 1, true)).toBe(0)
    expect(nextCycleIndex(0, 1, false)).toBe(0)
  })
})

describe('exchangeTargetIndex', () => {
  it('shifts the destination left when moving forward past it', () => {
    // The removal already happened, so the target sits one slot earlier.
    expect(exchangeTargetIndex(0, 2)).toBe(1)
  })

  it('keeps the destination when moving backwards or nowhere', () => {
    expect(exchangeTargetIndex(2, 0)).toBe(0)
    expect(exchangeTargetIndex(1, 1)).toBe(1)
  })
})

describe('moveItem', () => {
  it('reports success without touching the array when from equals to', () => {
    const a = ['x', 'y', 'z']
    expect(moveItem(a, 1, 1)).toBe(true)
    expect(a).toEqual(['x', 'y', 'z'])
  })

  it('reorders in place', () => {
    const a = ['x', 'y', 'z']
    expect(moveItem(a, 0, 2)).toBe(true)
    expect(a).toEqual(['y', 'z', 'x'])
  })

  it('clamps a destination past the end, which is how "move to last" works', () => {
    const a = ['x', 'y', 'z']
    expect(moveItem(a, 0, a.length - 1)).toBe(true)
    expect(a).toEqual(['y', 'z', 'x'])

    const b = ['x', 'y']
    expect(moveItem(b, 0, 99)).toBe(true)
    expect(b).toEqual(['y', 'x'])
  })

  it('leaves the array alone and reports false when from names no element', () => {
    const a = ['x', 'y']
    expect(moveItem(a, 5, 0)).toBe(false)
    expect(a).toEqual(['x', 'y'])
  })

  it('moves falsy elements too, which is how the original splice-array check behaved', () => {
    const a = [null, 'y'] as unknown as (string | null)[]
    expect(moveItem(a, 0, 1)).toBe(true)
    expect(a).toEqual(['y', null])
  })
})

describe('initialTabsToOpen', () => {
  it('prefers the welcome document over a blank tab', () => {
    expect(
      initialTabsToOpen({ welcomeMarkdown: '# hi', addBlankTab: true, markdownList: [] })
    ).toEqual([{ markdown: '# hi', selected: true }])
  })

  it('opens one selected blank tab when nothing else is asked for', () => {
    expect(initialTabsToOpen({ addBlankTab: true, markdownList: [] })).toEqual([{ selected: true }])
  })

  it('opens every seeded document but selects only the first', () => {
    expect(initialTabsToOpen({ markdownList: ['a', 'b'] })).toEqual([
      { markdown: 'a', selected: true },
      { markdown: 'b', selected: false }
    ])
  })

  it('asks for nothing when the window restores a session', () => {
    expect(initialTabsToOpen({ markdownList: [] })).toEqual([])
  })
})

describe('createFileChangedEvent', () => {
  it('carries exactly the fields the editor reload needs', () => {
    const file = tab('a', { blocks: [{ type: 'p' }] })
    expect(Object.keys(createFileChangedEvent(file)).sort()).toEqual(
      [
        'blocks',
        'cursor',
        'history',
        'id',
        'markdown',
        'muyaIndexCursor',
        'renderCursor',
        'scrollTop'
      ].sort()
    )
  })

  it('reads the values off the given tab and always asks for the cursor to be rendered', () => {
    const file = tab('a', { markdown: 'edited', scrollTop: 42, cursor: { offset: 3 } })
    expect(createFileChangedEvent(file)).toMatchObject({
      id: 'a',
      markdown: 'edited',
      scrollTop: 42,
      cursor: { offset: 3 },
      renderCursor: true
    })
  })
})
