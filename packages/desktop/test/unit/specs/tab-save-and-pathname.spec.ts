import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// O12(5): SET_PATHNAME, MARK_TAB_SAVED and TAB_SAVE_FAILURE used to be three
// anonymous IPC callbacks inside LISTEN_FOR_SET_PATHNAME — the save round trip
// main drives back into the renderer. Naming them makes the round trip testable;
// these cases pin what each one owes the tab it is told about.

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
  // Strips the last segment so DIRNAME assertions mean something.
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
    join: (...parts: string[]) => parts.filter(Boolean).join('/'),
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1)
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(false))
}))

import notice from '@/services/notification'
import { useEditorStore } from '@/store/editor'

const makeTab = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  filename: 'untitled.md',
  pathname: '',
  markdown: '# note\n',
  isSaved: false,
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 2,
  history: { stack: [{ id: 7 }, { id: 8 }], index: 1, lastEditIndex: 1, lastInitIndex: 0 },
  lastSavedHistoryId: 0,
  notifications: [],
  scrollTop: 0,
  cursor: null,
  muyaIndexCursor: null,
  wordCount: null,
  ...overrides
})

const seed = (store: ReturnType<typeof useEditorStore>, tabs: Record<string, unknown>[]) => {
  store.tabs = tabs as unknown as typeof store.tabs
  store.currentFile = tabs[0] as unknown as typeof store.currentFile
  store.tabIdToIndex = Object.fromEntries(tabs.map((t, i) => [t.id as string, i]))
}

describe('useEditorStore.SET_PATHNAME', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('adopts the new path, keeps the tab clean and points DIRNAME at it', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, [tab])

    store.SET_PATHNAME({ id: 'tab-1', pathname: '/tmp/note.md', filename: 'note.md' })

    expect(tab).toMatchObject({ pathname: '/tmp/note.md', filename: 'note.md', isSaved: true })
    expect(window.DIRNAME).toBe('/tmp')
  })

  it('closes a tab already open on the destination path', () => {
    const store = useEditorStore()
    const tab = makeTab()
    const other = makeTab({ id: 'tab-2', pathname: '/tmp/note.md', isSaved: true })
    seed(store, [tab, other])

    store.SET_PATHNAME({ id: 'tab-1', pathname: '/tmp/note.md', filename: 'note.md' })

    expect(store.tabs.map((t) => t.id)).toEqual(['tab-1'])
  })

  it('does nothing for a tab that is gone', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, [tab])
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.SET_PATHNAME({ id: 'nope', pathname: '/tmp/note.md', filename: 'note.md' })

    expect(err).toHaveBeenCalledWith('[ERROR] Cannot change file path from unknown tab.')
    expect(tab.pathname).toBe('')
    err.mockRestore()
  })
})

describe('useEditorStore.MARK_TAB_SAVED', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('records the frame that was written and clears the dirty flag', () => {
    const store = useEditorStore()
    const tab = makeTab({ isSaved: false })
    seed(store, [tab])

    store.MARK_TAB_SAVED('tab-1')

    expect(tab.isSaved).toBe(true)
    expect(tab.lastSavedHistoryId).toBe(8)
  })

  it('leaves the saved frame alone when the history has no usable frame', () => {
    const store = useEditorStore()
    const tab = makeTab({ history: { stack: [{ id: 7 }], index: -1, lastEditIndex: -1 } })
    seed(store, [tab])

    store.MARK_TAB_SAVED('tab-1')

    expect(tab.lastSavedHistoryId).toBe(0)
    expect(tab.isSaved).toBe(true)
  })

  it('ignores a tab that closed while the save was in flight', () => {
    const store = useEditorStore()
    const tab = makeTab()
    seed(store, [tab])

    expect(() => store.MARK_TAB_SAVED('gone')).not.toThrow()
    expect(tab.isSaved).toBe(false)
  })
})

describe('useEditorStore.TAB_SAVE_FAILURE', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('re-arms the dirty flag and banners the tab it happened to', () => {
    const store = useEditorStore()
    const tab = makeTab({ isSaved: true })
    seed(store, [tab])

    store.TAB_SAVE_FAILURE('tab-1', 'EACCES')

    expect(tab.isSaved).toBe(false)
    // The message text comes from the live i18n tables, so assert its shape and
    // that the OS error made it in, not the English wording (the machine
    // locale is not English).
    const banners = tab.notifications as Array<Record<string, unknown>>
    expect(banners).toHaveLength(1)
    expect(banners[0]).toMatchObject({ style: 'crit', showConfirm: false })
    expect(banners[0]?.msg).toContain('EACCES')
  })

  it('falls back to a global notice when no tab owns the failure', () => {
    const store = useEditorStore()
    seed(store, [makeTab()])

    store.TAB_SAVE_FAILURE('gone', 'EACCES')

    expect(notice.notify).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(notice.notify).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ type: 'error', message: 'EACCES' })
    // i18n runs for real here, so assert a resolved string came out rather than
    // pinning the English wording the machine locale may not show.
    expect(payload.title).not.toBe('dialog.saveFailure')
    expect(typeof payload.title).toBe('string')
    expect((payload.title as string).length).toBeGreaterThan(0)
  })
})

// O12(12): the rename paths and the save/save-as pair. `RENAME` and
// `RENAME_IF_NEEDED` had no test anywhere before this file grew them, and the
// last case here is the one the extraction leans on: FILE_SAVE and FILE_SAVE_AS
// were eighteen lines written twice, differing only by channel.

describe('useEditorStore.RENAME', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.DIRNAME = ''
  })

  it('asks main to rename the file inside its current folder', () => {
    const store = useEditorStore()
    seed(store, [makeTab({ pathname: '/docs/note.md', filename: 'note.md' })])
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RENAME('other.md')

    const call = send.mock.calls.find((c: unknown[]) => c[0] === 'mt::rename')
    expect(call?.[1]).toMatchObject({
      id: 'tab-1',
      pathname: '/docs/note.md',
      newPathname: '/docs/other.md'
    })
  })

  it('says nothing when the name did not change', () => {
    const store = useEditorStore()
    seed(store, [makeTab({ pathname: '/docs/note.md', filename: 'note.md' })])
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RENAME('note.md')

    expect(send.mock.calls.some((c: unknown[]) => c[0] === 'mt::rename')).toBe(false)
  })

  it('says nothing without a current tab', () => {
    const store = useEditorStore()
    seed(store, [makeTab()])
    store.currentFile = null
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RENAME('other.md')

    expect(send.mock.calls.some((c: unknown[]) => c[0] === 'mt::rename')).toBe(false)
  })
})

describe('useEditorStore.RENAME_IF_NEEDED', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.DIRNAME = ''
  })

  const threeTabs = () => [
    makeTab({ id: 'a', pathname: '/docs/a.md', filename: 'a.md' }),
    makeTab({ id: 'b', pathname: '/docs/b.md', filename: 'b.md' }),
    makeTab({ id: 'c', pathname: '/elsewhere/a.md', filename: 'a.md' })
  ]

  it('rewrites only the tabs pointing at the renamed path', () => {
    const store = useEditorStore()
    seed(store, threeTabs())

    store.RENAME_IF_NEEDED({ src: '/docs/a.md', dest: '/new/folder/x.md' })

    expect(store.tabs.map((t) => `${t.pathname}|${t.filename}`)).toEqual([
      '/new/folder/x.md|x.md',
      '/docs/b.md|b.md',
      '/elsewhere/a.md|a.md'
    ])
  })

  it('moves DIRNAME when the active tab is the one that was renamed', () => {
    const store = useEditorStore()
    seed(store, threeTabs())
    window.DIRNAME = '/docs'

    store.RENAME_IF_NEEDED({ src: '/docs/a.md', dest: '/new/folder/x.md' })

    expect(window.DIRNAME).toBe('/new/folder')
  })

  it('leaves DIRNAME alone when the active tab is unrelated', () => {
    const store = useEditorStore()
    const tabs = threeTabs()
    seed(store, tabs)
    store.currentFile = tabs[1] as unknown as typeof store.currentFile
    window.DIRNAME = '/docs'

    store.RENAME_IF_NEEDED({ src: '/docs/a.md', dest: '/new/folder/x.md' })

    expect(window.DIRNAME).toBe('/docs')
  })
})

describe('useEditorStore.FILE_SAVE / FILE_SAVE_AS', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.DIRNAME = ''
  })

  it('send one field-for-field identical request and differ only by channel', () => {
    const store = useEditorStore()
    seed(store, [makeTab({ pathname: '/docs/note.md', filename: 'note.md' })])
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE()
    store.FILE_SAVE_AS()

    const save = send.mock.calls.filter((c: unknown[]) => c[0] === 'mt::response-file-save')
    const saveAs = send.mock.calls.filter((c: unknown[]) => c[0] === 'mt::response-file-save-as')
    expect(save).toHaveLength(1)
    expect(saveAs).toHaveLength(1)
    // The whole point of the shared sender: the arguments are one shape, so a
    // change to the payload can only be made once.
    expect(saveAs[0].slice(1)).toEqual(save[0].slice(1))
    expect(save[0][1]).toBe('tab-1')
  })

  it('writes nothing when there is no current tab', () => {
    const store = useEditorStore()
    seed(store, [makeTab()])
    store.currentFile = null
    const send = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE()
    store.FILE_SAVE_AS()

    expect(
      send.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith('mt::response-file-save'))
    ).toEqual([])
  })
})
