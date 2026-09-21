import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// O12(5): HANDLE_DISK_CHANGE used to be an IPC callback inline in
// LISTEN_FOR_FILE_CHANGE, so nothing below the IPC boundary could be tested.
// These cases pin the three outcomes the #1861 fix turned on, because each one
// is user-visible: silently reload, warn before reloading, or say nothing.

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

import notice from '@/services/notification'
import { debouncedSendBufferedState } from '@/store/bufferedState'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const PATH = '/tmp/note.md'

const makeTab = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  filename: 'note.md',
  pathname: PATH,
  markdown: '# on disk\n',
  isSaved: true,
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

const seed = (
  store: ReturnType<typeof useEditorStore>,
  tab: Record<string, unknown>,
  autoSave: boolean
) => {
  store.tabs = [tab] as unknown as typeof store.tabs
  store.currentFile = tab as unknown as typeof store.currentFile
  store.tabIdToIndex = { 'tab-1': 0 }
  usePreferencesStore().$patch({ autoSave })
}

const diskData = (markdown: string) => ({
  pathname: PATH,
  data: {
    markdown,
    filename: 'note.md',
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    isMixedLineEndings: false
  }
})

describe('useEditorStore.HANDLE_DISK_CHANGE', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('says nothing about a tab that is not open', () => {
    const store = useEditorStore()
    store.tabs = [] as unknown as typeof store.tabs
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.HANDLE_DISK_CHANGE({ type: 'change', change: diskData('# elsewhere\n') as never })

    // Nothing in this action reaches `notice`, so the guard is observed through
    // the log line it prints and the absence of any other effect.
    expect(err).toHaveBeenCalledWith(`HANDLE_DISK_CHANGE: Cannot find tab for path "${PATH}".`)
    expect(notice.notify).not.toHaveBeenCalled()
    expect(debouncedSendBufferedState).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('marks the tab dirty and warns when the file disappeared', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, tab, false)

    store.HANDLE_DISK_CHANGE({ type: 'unlink', change: { pathname: PATH } as never })

    expect(tab.isSaved).toBe(false)
    expect(tab.notifications).toHaveLength(1)
    expect(tab.notifications[0]).toMatchObject({
      style: 'warn',
      showConfirm: false,
      exclusiveType: 'file_changed'
    })
  })

  it('stays quiet when only the file metadata changed on disk (#1861)', () => {
    const store = useEditorStore()
    const tab = makeTab({ isSaved: false })
    seed(store, tab, false)

    store.HANDLE_DISK_CHANGE({ type: 'change', change: diskData('# on disk\n') as never })

    expect(tab.notifications).toHaveLength(0)
    expect(tab.isSaved).toBe(false)
    // The byte-identical branch leaves before the buffer write, so nothing is
    // scheduled at all — this is what separates it from the reload branch below.
    expect(debouncedSendBufferedState).not.toHaveBeenCalled()
  })

  it('reloads a saved tab without warning when auto-save is on', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, tab, true)

    store.HANDLE_DISK_CHANGE({ type: 'change', change: diskData('# rewritten\n') as never })

    expect(tab.markdown).toBe('# rewritten\n')
    expect(tab.notifications).toHaveLength(0)
    // Exactly one buffer write: the reload path returns early, and the single
    // call is the one loadChange makes for itself.
    expect(debouncedSendBufferedState).toHaveBeenCalledTimes(1)
  })

  it('warns before reloading when the tab holds unsaved work', () => {
    const store = useEditorStore()
    const tab = makeTab({ isSaved: false })
    seed(store, tab, false)

    store.HANDLE_DISK_CHANGE({ type: 'change', change: diskData('# rewritten\n') as never })

    expect(tab.markdown).toBe('# on disk\n')
    expect(tab.isSaved).toBe(false)
    expect(tab.notifications).toHaveLength(1)
    expect(tab.notifications[0]).toMatchObject({ showConfirm: true, exclusiveType: 'file_changed' })
    // The warning path does write the buffer once, unlike the ignore path.
    expect(debouncedSendBufferedState).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown change type instead of guessing', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, tab, false)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.HANDLE_DISK_CHANGE({
      type: 'sideways',
      change: diskData('# rewritten\n') as never
    } as never)

    expect(err).toHaveBeenCalledWith('HANDLE_DISK_CHANGE: Invalid type "sideways"')
    expect(tab.markdown).toBe('# on disk\n')
    err.mockRestore()
  })
})
