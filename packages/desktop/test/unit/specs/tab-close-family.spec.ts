import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// `@/store/editor` reads `window.path` at module load and `window.electron` at
// runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/'))
  }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
// The session-buffer write is a side effect of every close; stub it so these
// assertions see the tab bookkeeping and not a debounce timer.
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve())
}))

import { useEditorStore } from '@/store/editor'
import bus from '@/bus'

const send = (window.electron.ipcRenderer.send as ReturnType<typeof vi.fn>).mock
const sentChannels = (): string[] => send.calls.map((c: unknown[]) => String(c[0]))
const sentOn = (channel: string): unknown[][] =>
  send.calls.filter((c: unknown[]) => c[0] === channel).map((c: unknown[]) => c.slice(1))

const tab = (id: string, over: Partial<IFileState> = {}): IFileState =>
  ({
    id,
    filename: `${id}.md`,
    pathname: `/docs/${id}.md`,
    markdown: `# ${id}`,
    isSaved: true,
    history: {},
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: null,
    ...over
  }) as unknown as IFileState

type Store = ReturnType<typeof useEditorStore>

// Only the emptiness of the two outline mirrors is under test below, so the
// entries are shaped loosely rather than re-declaring the TOC types here.
const oneListItem = () =>
  [{ slug: 'a', githubSlug: 'a', content: 'A', lvl: 1 }] as unknown as Store['listToc']
const oneTreeNode = () => [{ slug: 'a', lvl: 1 }] as unknown as Store['toc']

const seed = (ids: string[], currentId?: string) => {
  const store = useEditorStore()
  store.tabs = ids.map((id) => tab(id))
  store.currentFile = currentId ? (store.tabs.find((t) => t.id === currentId) ?? null) : null
  store.updateTabIdToIndex()
  return store
}

beforeEach(() => {
  // `bus` is a module singleton, so a `vi.spyOn(bus, 'emit')` left installed by
  // a failing assertion would keep collecting calls into the next test's spy.
  vi.restoreAllMocks()
  setActivePinia(createPinia())
  send.calls.length = 0
  window.DIRNAME = ''
})

describe('CLOSE_TABS — the batch close behind "save all / discard changes"', () => {
  it('does nothing for an empty or missing id list', () => {
    const store = seed(['a', 'b'], 'a')
    store.CLOSE_TABS([])
    store.CLOSE_TABS(null as unknown as string[])
    expect(store.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(sentChannels()).toEqual([])
  })

  it('splices every listed tab and reports each closed pathname once', () => {
    const store = seed(['a', 'b', 'c'], 'b')
    store.CLOSE_TABS(['a', 'c'])
    expect(store.tabs.map((t) => t.id)).toEqual(['b'])
    expect(sentOn('mt::window-tab-closed')).toEqual([['/docs/a.md'], ['/docs/c.md']])
    expect(store.tabIdToIndex).toEqual({ b: 0 })
  })

  it('skips ids that are not open instead of closing the wrong tab', () => {
    const store = seed(['a', 'b'], 'a')
    store.CLOSE_TABS(['nope'])
    expect(store.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(sentChannels()).toEqual([])
  })

  it('keeps the current tab when only the others close', () => {
    const store = seed(['a', 'b', 'c'], 'a')
    store.CLOSE_TABS(['b', 'c'])
    expect(store.currentFile?.id).toBe('a')
    expect(window.DIRNAME).toBe('')
  })

  it('re-selects a surviving tab when the current one closes', () => {
    const store = seed(['a', 'b', 'c'], 'b')
    store.CLOSE_TABS(['b'])
    // `tabIndex` records the slot the single closed tab left behind, so after
    // the splice the list is [a, c] and slot 1 is `c` — the re-selection is
    // what re-points DIRNAME and emits `file-changed`.
    expect(store.currentFile?.id).toBe('c')
    expect(window.DIRNAME).toBe('/docs')
    expect(sentChannels()).toContain('mt::window-tab-closed')
  })

  it('emits file-changed with the re-selected document', () => {
    const emit = vi.spyOn(bus, 'emit')
    const store = seed(['a', 'b'], 'a')
    store.CLOSE_TABS(['a'])
    const changed = emit.mock.calls.filter(
      (c: unknown[]) => c[0] === 'file-changed'
    ) as unknown as [string, { id: string }][]
    expect(changed).toHaveLength(1)
    expect(changed[0][1].id).toBe('b')
    emit.mockRestore()
  })

  it('clears both outline lists once no tab survives', () => {
    const store = seed(['a'], 'a')
    store.listToc = oneListItem()
    store.toc = oneTreeNode()
    store.CLOSE_TABS(['a'])
    expect(store.tabs).toEqual([])
    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
    expect(store.currentFile).toBeNull()
  })

  it('leaves the outline alone when a tab survives', () => {
    const store = seed(['a', 'b'], 'a')
    store.listToc = oneListItem()
    store.CLOSE_TABS(['a'])
    expect(store.listToc).toHaveLength(1)
  })

  it('closes an untitled tab without reporting a pathname to main', () => {
    const store = seed(['a', 'b'], 'a')
    store.tabs[0].pathname = ''
    store.CLOSE_TABS(['a'])
    expect(store.tabs.map((t) => t.id)).toEqual(['b'])
    // The notification is per closed pathname, so an unsaved document that was
    // never on disk closes silently.
    expect(sentOn('mt::window-tab-closed')).toEqual([])
  })
})

describe('CLOSE_TAB — the dispatch in front of the two close paths', () => {
  it('closes a saved tab right away', () => {
    const store = seed(['a', 'b'], 'a')
    store.CLOSE_TAB(store.tabs[0])
    expect(store.tabs.map((t) => t.id)).toEqual(['b'])
    expect(sentChannels()).not.toContain('mt::save-and-close-tabs')
  })

  it('routes an unsaved tab through the save-and-close request instead of dropping it', () => {
    const store = seed(['a', 'b'], 'a')
    store.tabs[0].isSaved = false
    store.CLOSE_TAB(store.tabs[0])
    // The tab stays open until main answers with the batch close above.
    expect(store.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(sentOn('mt::save-and-close-tabs')).toEqual([
      [
        [
          {
            id: 'a',
            pathname: '/docs/a.md',
            filename: 'a.md',
            markdown: '# a',
            options: expect.any(Object)
          }
        ]
      ]
    ])
  })

  it('falls back to the current tab and no-ops when there is none', () => {
    const store = seed(['a', 'b'], 'b')
    store.CLOSE_TAB()
    expect(store.tabs.map((t) => t.id)).toEqual(['a'])
    const empty = seed([])
    empty.CLOSE_TAB()
    expect(empty.tabs).toEqual([])
  })
})

describe('FORCE_CLOSE_TAB — what a removal must clean up behind itself', () => {
  it('flushes the active editor only when the closing tab is the active one', () => {
    const emit = vi.spyOn(bus, 'emit')
    const store = seed(['a', 'b'], 'a')
    store.FORCE_CLOSE_TAB(store.tabs[1])
    expect(emit.mock.calls.some((c: unknown[]) => c[0] === 'flush-active-editor')).toBe(false)
    store.FORCE_CLOSE_TAB(store.tabs[0])
    expect(emit.mock.calls.some((c: unknown[]) => c[0] === 'flush-active-editor')).toBe(true)
    emit.mockRestore()
  })

  it('snapshots an unsaved document on close so "Don\'t Save" stays recoverable', () => {
    const store = seed(['a', 'b'], 'a')
    store.tabs[0].isSaved = false
    const snapshot = vi.fn()
    store.SAVE_VERSION_SNAPSHOT = snapshot
    store.FORCE_CLOSE_TAB(store.tabs[0])
    expect(snapshot).toHaveBeenCalledWith('Session End')
  })

  it('does not snapshot a saved document', () => {
    const store = seed(['a'], 'a')
    const snapshot = vi.fn()
    store.SAVE_VERSION_SNAPSHOT = snapshot
    store.FORCE_CLOSE_TAB(store.tabs[0])
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('clears DIRNAME when the surviving current tab has no markdown to show', () => {
    const store = seed(['a', 'b'], 'a')
    window.DIRNAME = '/docs'
    store.tabs[1].markdown = undefined as unknown as string
    store.FORCE_CLOSE_TAB(store.tabs[0])
    expect(store.currentFile?.id).toBe('b')
    expect(window.DIRNAME).toBe('')
  })
})

describe('the bulk close helpers iterate over a snapshot of the tab list', () => {
  it('CLOSE_OTHER_TABS keeps the tab it was given', () => {
    const store = seed(['a', 'b', 'c'], 'b')
    store.CLOSE_OTHER_TABS(store.tabs[1])
    expect(store.tabs.map((t) => t.id)).toEqual(['b'])
  })

  it('CLOSE_SAVED_TABS leaves unsaved tabs open', () => {
    const store = seed(['a', 'b', 'c'], 'a')
    store.tabs[1].isSaved = false
    store.CLOSE_SAVED_TABS()
    expect(store.tabs.map((t) => t.id)).toEqual(['b'])
  })

  it('CLOSE_ALL_TABS closes every tab despite splicing while iterating', () => {
    const store = seed(['a', 'b', 'c', 'd'], 'a')
    store.CLOSE_ALL_TABS()
    expect(store.tabs).toEqual([])
    expect(store.currentFile).toBeNull()
  })
})
