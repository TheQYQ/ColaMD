import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` reads `window.path` at module load and `window.electron`
// at runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

// M1.2b lazy-serialization store tiers. The engine's keystroke payload no
// longer carries a serialized markdown snapshot (markdown: null + edit: true);
// these tests pin the store-side behavior of that tier and of the correction
// path that restores cleanliness when an undo lands back on saved content.
describe('useEditorStore LISTEN_FOR_CONTENT_CHANGE — lazy-serialization tiers', () => {
  const makeTab = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: 'stale snapshot',
    isSaved: true,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    history: { stack: [{ id: 5 }], index: 0, lastEditIndex: 0, lastInitIndex: -1 },
    lastSavedHistoryId: 5,
    ...overrides
  })

  const seed = (store: ReturnType<typeof useEditorStore>, tab: Record<string, unknown>) => {
    store.tabs = [tab] as unknown as typeof store.tabs
    store.currentFile = tab as unknown as typeof store.currentFile
    store.tabIdToIndex = { 'tab-1': 0 }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keystroke tier marks dirty without touching the stale markdown snapshot', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, tab)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: null,
      edit: true,
      wordCount: null,
      cursor: { anchor: { key: 'k', offset: 3 } },
      history: null,
      toc: null,
      blocks: null
    })

    expect(tab.isSaved).toBe(false)
    expect(tab.markdown).toBe('stale snapshot') // NOT serialized yet
    expect(tab.cursor).toEqual({ anchor: { key: 'k', offset: 3 } })
    // The synthetic history is untouched — the id is only computed when the
    // content is actually serialized (pause tier / flush-on-read).
    expect(tab.history).toEqual({ stack: [{ id: 5 }], index: 0, lastEditIndex: 0, lastInitIndex: -1 })
  })

  it('keystroke tier re-arms auto-save with the current snapshot', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, tab)
    usePreferencesStore().$patch({ autoSave: true, autoSaveDelay: 1000 })
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: null,
      edit: true,
      wordCount: null,
      cursor: null,
      history: null,
      toc: null,
      blocks: null
    })
    vi.advanceTimersByTime(1000)

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    // In isolation the flush bus has no listener, so the snapshot stays as-is —
    // the point is that the auto-save fired off the keystroke tier.
    expect(call?.[4]).toBe('stale snapshot')
  })

  it('derived tier still updates blocks/wordCount without dirty bookkeeping', () => {
    const store = useEditorStore()
    const tab = makeTab() as Record<string, unknown>
    seed(store, tab)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: null,
      wordCount: { paragraph: 1, word: 10, character: 50, all: 52 },
      cursor: null,
      history: null,
      toc: null,
      blocks: { id: 'root' }
    })

    expect(tab.blocks).toEqual({ id: 'root' })
    expect(tab.wordCount).toEqual({ paragraph: 1, word: 10, character: 50, all: 52 })
    expect(tab.isSaved).toBe(true) // derived updates never touch cleanliness
  })

  it('full commit restores cleanliness when the content id equals the saved id (undo-to-saved, G6)', () => {
    const store = useEditorStore()
    const tab = makeTab({ isSaved: false })
    seed(store, tab)

    // The pipeline committed after an undo landed back on the saved content:
    // the synthetic id (5) matches lastSavedHistoryId (5).
    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'saved content\n',
      wordCount: null,
      cursor: null,
      history: { stack: [{ id: 5 }], index: 0, lastEditIndex: 0, lastInitIndex: -1 },
      toc: null,
      blocks: null
    })

    expect(tab.markdown).toBe('saved content\n')
    expect(tab.isSaved).toBe(true)
  })

  it('full commit with a new content id marks dirty and schedules auto-save', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const tab = makeTab({ isSaved: true })
    seed(store, tab)
    usePreferencesStore().$patch({ autoSave: true, autoSaveDelay: 1000 })
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'saved content and more\n',
      wordCount: null,
      cursor: null,
      history: { stack: [{ id: 9 }], index: 0, lastEditIndex: 0, lastInitIndex: -1 },
      toc: null,
      blocks: null
    })

    expect(tab.isSaved).toBe(false)
    vi.advanceTimersByTime(1000)
    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[4]).toBe('saved content and more\n')
  })
})
