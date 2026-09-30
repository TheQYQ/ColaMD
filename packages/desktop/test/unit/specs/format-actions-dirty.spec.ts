import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Changing line ending / encoding / final-newline is METADATA ONLY: there is no
// main-process handler for `mt::set-line-ending` (only the menu sends it,
// `src/main/menu/actions/edit.ts:132`), and the other two are renderer bus
// events. Nothing is written to disk, yet all three used to set
// `currentFile.isSaved = true`. That dropped the dirty flag, so closing the tab
// stopped asking, and on the next launch `main/windows/editor.ts:641-646` -- whose
// rule is "a saved tab may be replaced by the on-disk text" -- overwrote the
// unsaved buffer with the file. Silent loss of the edits (issue #26 item 1).

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(false))
}))

import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

const makeTab = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  filename: 'note.md',
  pathname: '/tmp/note.md',
  markdown: '# on disk\n\nadded after opening\n',
  isSaved: false,
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 2,
  history: { stack: [{ id: 5 }], index: 0, lastEditIndex: 0, lastInitIndex: -1 },
  lastSavedHistoryId: 5,
  notifications: [],
  scrollTop: 0,
  cursor: null,
  muyaIndexCursor: null,
  wordCount: null,
  ...overrides
})

const seed = (tab: Record<string, unknown>) => {
  const store = useEditorStore()
  store.tabs = [tab] as unknown as typeof store.tabs
  store.currentFile = tab as unknown as typeof store.currentFile
  store.tabIdToIndex = { 'tab-1': 0 }
  return store
}

describe('format-only actions must not drop the unsaved marker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SET_LINE_ENDING leaves a dirty tab dirty and still records the ending', () => {
    const tab = makeTab()
    const store = seed(tab)

    store.SET_LINE_ENDING('crlf')

    // The part the action is for:
    expect(tab.lineEnding).toBe('crlf')
    expect(tab.adjustLineEndingOnSave).toBe(true)
    // The part it must not touch:
    expect(tab.isSaved).toBe(false)
  })

  it('changing the encoding leaves a dirty tab dirty', () => {
    const tab = makeTab()
    const store = seed(tab)
    store.LISTEN_FOR_SET_ENCODING()

    bus.emit('mt::set-file-encoding', 'gb18030')

    expect(tab.encoding.encoding).toBe('gb18030')
    expect(tab.isSaved).toBe(false)
  })

  it('changing the final-newline setting leaves a dirty tab dirty', () => {
    const tab = makeTab()
    const store = seed(tab)
    store.LISTEN_FOR_SET_FINAL_NEWLINE()

    bus.emit('mt::set-final-newline', 1)

    expect(tab.trimTrailingNewline).toBe(1)
    expect(tab.isSaved).toBe(false)
  })

  it('a clean tab does not become dirty (the fix must not invent unsaved work)', () => {
    const tab = makeTab({ isSaved: true })
    const store = seed(tab)

    store.SET_LINE_ENDING('crlf')

    expect(tab.isSaved).toBe(true)
  })

  it('setting the same value again changes nothing at all', () => {
    const tab = makeTab({ isSaved: true, lineEnding: 'crlf', adjustLineEndingOnSave: true })
    const store = seed(tab)

    store.SET_LINE_ENDING('crlf')

    expect(tab.isSaved).toBe(true)
    expect(tab.lineEnding).toBe('crlf')
  })
})
