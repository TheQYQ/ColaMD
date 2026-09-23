import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// `@/store/editor` reads `window.path` at module load and `window.electron` at
// runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: {
        sep: string
        dirname: (p: string) => string
        join: (...p: string[]) => string
        basename: (p: string) => string
      }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
    join: (...parts: string[]) => parts.filter(Boolean).join('/'),
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1)
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve())
}))

import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import bus from '@/bus'

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

/** Seed tabs and make "which tab became current" observable without running
 * the whole activation path (UPDATE_CURRENT_FILE touches the engine bus). */
const seed = (ids: string[], currentId?: string) => {
  const store = useEditorStore()
  store.tabs = ids.map((id) => tab(id))
  store.currentFile = currentId ? (store.tabs.find((t) => t.id === currentId) ?? null) : null
  store.updateTabIdToIndex()
  const activated = vi.fn()
  store.UPDATE_CURRENT_FILE = activated
  return { store, activated }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  window.DIRNAME = ''
})

describe('EXCHANGE_TABS_BY_ID', () => {
  it('moves a tab onto the target slot and refreshes the id index', () => {
    const { store } = seed(['a', 'b', 'c'], 'a')
    store.EXCHANGE_TABS_BY_ID({ fromId: 'a', toId: 'c' })
    // `exchangeTargetIndex` converts the drop target to the slot the moved tab
    // lands in AFTER being spliced out of its own place, so dragging `a` onto
    // `c` puts it just left of `c` rather than on its old index.
    expect(store.tabs.map((t) => t.id)).toEqual(['b', 'a', 'c'])
    expect(store.tabIdToIndex).toEqual({ b: 0, a: 1, c: 2 })
  })

  it('drops a tab at the end when no target is given', () => {
    const { store } = seed(['a', 'b', 'c'], 'a')
    store.EXCHANGE_TABS_BY_ID({ fromId: 'a', toId: null })
    expect(store.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('does nothing when either id is not open', () => {
    const { store } = seed(['a', 'b'], 'a')
    store.EXCHANGE_TABS_BY_ID({ fromId: 'nope', toId: 'b' })
    store.EXCHANGE_TABS_BY_ID({ fromId: 'a', toId: 'nope' })
    expect(store.tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('CYCLE_TABS', () => {
  it('steps right and wraps at the end', () => {
    const { store, activated } = seed(['a', 'b', 'c'], 'b')
    store.CYCLE_TABS(true)
    expect(activated).toHaveBeenCalledWith(store.tabs[2])
    // Activation is stubbed, so move the current pointer the way
    // UPDATE_CURRENT_FILE would have before cycling again.
    store.currentFile = store.tabs[2]
    store.CYCLE_TABS(true)
    expect(activated).toHaveBeenLastCalledWith(store.tabs[0])
  })

  it('steps left and wraps at the start', () => {
    const { store, activated } = seed(['a', 'b', 'c'], 'a')
    store.CYCLE_TABS(false)
    expect(activated).toHaveBeenCalledWith(store.tabs[2])
  })

  it('does nothing with a single tab or no current tab', () => {
    const single = seed(['a'], 'a')
    single.store.CYCLE_TABS(true)
    expect(single.activated).not.toHaveBeenCalled()

    const orphan = seed(['a', 'b'])
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    orphan.store.CYCLE_TABS(true)
    expect(orphan.activated).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})

describe('SWITCH_TAB_BY_FILEPATH / SWITCH_TAB_BY_INDEX', () => {
  it('switches to the tab that owns the path', () => {
    const { store, activated } = seed(['a', 'b'], 'a')
    store.SWITCH_TAB_BY_FILEPATH('/docs/b.md')
    expect(activated).toHaveBeenCalledWith(store.tabs[1])
  })

  it('ignores an empty path and a path no tab owns', () => {
    const { store, activated } = seed(['a', 'b'], 'a')
    store.SWITCH_TAB_BY_FILEPATH('')
    store.SWITCH_TAB_BY_FILEPATH('/docs/gone.md')
    expect(activated).not.toHaveBeenCalled()
  })

  it('switches by index and refuses one out of range', () => {
    const { store, activated } = seed(['a', 'b', 'c'], 'a')
    store.SWITCH_TAB_BY_INDEX(2)
    expect(activated).toHaveBeenCalledWith(store.tabs[2])
    store.SWITCH_TAB_BY_INDEX(9)
    store.SWITCH_TAB_BY_INDEX(-1)
    expect(activated).toHaveBeenCalledTimes(1)
  })

  it('refuses to switch by index without a current tab', () => {
    const { store, activated } = seed(['a', 'b'])
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.SWITCH_TAB_BY_INDEX(1)
    expect(activated).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})

describe('NEW_UNTITLED_TAB', () => {
  it('selects the new tab and reports it loaded by default', () => {
    const { store, activated } = seed(['a'], 'a')
    const emit = vi.spyOn(bus, 'emit')
    store.NEW_UNTITLED_TAB({})

    expect(activated).toHaveBeenCalledTimes(1)
    // The tab reaches `tabs` through UPDATE_CURRENT_FILE, which this file
    // stubs; what the action owes is the blank state it hands over.
    const created = activated.mock.calls[0][0] as IFileState
    expect(created.pathname).toBe('')
    expect(
      emit.mock.calls.some(
        (c: unknown[]) => c[0] === 'file-loaded' && (c[1] as { id?: string })?.id === created.id
      )
    ).toBe(true)
  })

  it('seeds content and can open in the background', () => {
    const { store, activated } = seed(['a'], 'a')
    store.NEW_UNTITLED_TAB({ markdown: '# from seed\n', selected: false })

    expect(activated).not.toHaveBeenCalled()
    const added = store.tabs[1]
    expect(added.markdown).toBe('# from seed\n')
    expect(store.currentFile?.id).toBe('a')
    expect(store.tabIdToIndex[added.id]).toBe(1)
  })
})

describe('NEW_TAB_WITH_CONTENT', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    pathname: '/docs/new.md',
    filename: 'new.md',
    markdown: '# new\n',
    ...over
  })

  it('falls back to an untitled tab when there is no document', () => {
    const { store } = seed(['a'], 'a')
    const untitled = vi.fn()
    store.NEW_UNTITLED_TAB = untitled
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: null })
    expect(untitled).toHaveBeenCalledWith({})
  })

  it('activates the tab already open on that path instead of opening a second one', () => {
    const { store, activated } = seed(['a', 'b'], 'a')
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: doc({ pathname: '/docs/b.md' }) as unknown as never
    })
    expect(activated).toHaveBeenCalledWith(store.tabs[1])
    expect(store.tabs).toHaveLength(2)
  })

  it('opens, activates and reports the document loaded', () => {
    const { store, activated } = seed(['a'], 'a')
    const emit = vi.spyOn(bus, 'emit')
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: doc() as unknown as never })

    const opened = activated.mock.calls[0][0] as IFileState
    expect(opened.pathname).toBe('/docs/new.md')
    expect(
      emit.mock.calls.some(
        (c: unknown[]) =>
          c[0] === 'file-loaded' && (c[1] as { markdown?: string })?.markdown === '# new\n'
      )
    ).toBe(true)
  })

  it('closes a saved untitled tab and keeps the tab bar state', () => {
    const { store, activated } = seed(['a'], 'a')
    store.tabs[0].pathname = ''
    const closed = vi.fn()
    const layout = useLayoutStore()
    const setLayout = vi.spyOn(layout, 'SET_LAYOUT')
    store.FORCE_CLOSE_TAB = closed

    store.NEW_TAB_WITH_CONTENT({ markdownDocument: doc() as unknown as never })

    expect(closed).toHaveBeenCalledWith(store.tabs[0])
    expect(setLayout).not.toHaveBeenCalled()
    expect((activated.mock.calls[0][0] as IFileState).pathname).toBe('/docs/new.md')
  })

  it('banners mixed line endings once the document is open', () => {
    const { store } = seed(['a'], 'a')
    const notified = vi.fn()
    store.pushTabNotification = notified
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: doc({ isMixedLineEndings: true, lineEnding: 'crlf' }) as unknown as never
    })
    expect(notified).toHaveBeenCalledTimes(1)
    const payload = notified.mock.calls[0][0] as { msg: string }
    expect(typeof payload.msg).toBe('string')
    expect(payload.msg.length).toBeGreaterThan(0)
  })
})

describe('SHOW_TAB_VIEW', () => {
  it('shows the tab bar when forced or when one tab is open', () => {
    const { store } = seed(['a'], 'a')
    const layout = useLayoutStore()
    const setLayout = vi.spyOn(layout, 'SET_LAYOUT').mockImplementation(() => {})

    store.SHOW_TAB_VIEW(true)
    expect(setLayout).toHaveBeenCalledWith({ showTabBar: true })

    setLayout.mockClear()
    store.SHOW_TAB_VIEW(false)
    expect(setLayout).toHaveBeenCalledTimes(1)

    setLayout.mockClear()
    store.tabs = [tab('a'), tab('b')]
    store.SHOW_TAB_VIEW(false)
    expect(setLayout).not.toHaveBeenCalled()
  })
})
