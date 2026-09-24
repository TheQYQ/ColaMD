import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// O12(17): reloading a file that changed on disk, and what the window asks
// before it closes. `loadChange` already has a content-check spec; what is
// pinned here is the part that is easy to break by accident — a reload must
// swap the DOCUMENT without swapping the TAB's identity (id, notifications,
// scroll position, history boundary), and the close request must distinguish
// "nothing unsaved" from "ask the user".

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: { sep: string; dirname: (p: string) => string }
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
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/'))
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: vi.fn() }
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
import { debouncedSendBufferedState } from '@/store/bufferedState'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

const send = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.send)
const on = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.on)

const tab = (over: Partial<IFileState> = {}): IFileState =>
  ({
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/docs/note.md',
    markdown: '# on disk\n',
    isSaved: true,
    history: { stack: [{ id: 1 }], index: 0, lastEditIndex: 0, lastInitIndex: 0 },
    cursor: null,
    scrollTop: 42,
    muyaIndexCursor: null,
    notifications: [],
    ...over
  }) as unknown as IFileState

const seed = (tabs: IFileState[]) => {
  const store = useEditorStore()
  store.tabs = tabs
  store.currentFile = tabs[0] ?? null
  store.updateTabIdToIndex()
  return store
}

const change = (over: Record<string, unknown> = {}) =>
  ({
    pathname: '/docs/note.md',
    data: {
      markdown: '# reloaded\n',
      filename: 'note.md',
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 2,
      encoding: { encoding: 'utf8', isBom: false },
      ...over
    }
  }) as never

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  window.DIRNAME = ''
})

describe('loadChange', () => {
  it('reports instead of crashing when the tab is gone by the time the change lands', () => {
    const store = seed([tab()])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.loadChange({ pathname: '/docs/gone.md', data: { markdown: 'x' } } as never)

    expect(error).toHaveBeenCalled()
    expect(notice.notify).toHaveBeenCalledTimes(1)
    expect(store.tabs).toHaveLength(1)
  })

  it('swaps the document while keeping the tab identity', () => {
    const original = tab({
      notifications: [{ msg: 'keep me' } as never],
      scrollTop: 77
    })
    const store = seed([original])
    // The store hands back reactive proxies, so identity is measured
    // against what the store itself holds, not the literal that went in.
    const before = store.tabs[0]

    store.loadChange(change())

    expect(store.tabs).toHaveLength(1)
    const reloaded = store.tabs[0]
    expect(reloaded).toBe(before)
    expect(reloaded.id).toBe('tab-1')
    expect(reloaded.markdown).toBe('# reloaded\n')
    expect(reloaded.scrollTop).toBe(77)
    expect(reloaded.notifications).toHaveLength(1)
  })

  it('tells the editor to reload when the changed file is the one on screen', () => {
    const store = seed([tab()])
    const emit = vi.spyOn(bus, 'emit')

    store.loadChange(change())

    const changed = emit.mock.calls.filter((c) => c[0] === 'file-changed') as unknown as [
      'file-changed',
      { markdown: string }
    ][]
    expect(changed).toHaveLength(1)
    expect(changed[0][1].markdown).toBe('# reloaded\n')
  })

  it('stays quiet for a background tab', () => {
    const store = seed([tab({ id: 'a', pathname: '/docs/a.md' }), tab({ id: 'b' })])
    const emit = vi.spyOn(bus, 'emit')

    store.loadChange(change())

    expect(emit.mock.calls.some((c: unknown[]) => c[0] === 'file-changed')).toBe(false)
    expect(store.currentFile?.id).toBe('a')
  })

  it('banners a normalised line ending on the reloaded tab', () => {
    const store = seed([tab()])
    const notified = vi.spyOn(store, 'pushTabNotification')

    store.loadChange(change({ isMixedLineEndings: true, lineEnding: 'crlf' }))

    expect(notified).toHaveBeenCalledTimes(1)
    expect(notified.mock.calls[0][0]).toMatchObject({ tabId: 'tab-1', style: 'info' })
  })
})

describe('LISTEN_FOR_CLOSE', () => {
  const fireClose = async () => {
    const handler = on()
      .mock.calls.filter((c: unknown[]) => c[0] === 'mt::ask-for-close')
      .map((c: unknown[]) => c[1] as () => void)
      .pop()
    expect(handler).toBeTruthy()
    ;(handler as () => void)()
    await Promise.resolve()
    await Promise.resolve()
  }

  it('closes without asking when nothing holds unsaved work', async () => {
    const store = seed([tab({ isSaved: true }), tab({ id: 'b', isSaved: true })])
    store.LISTEN_FOR_CLOSE()

    await fireClose()

    const channels = send().mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toContain('mt::close-window')
    expect(channels).not.toContain('mt::close-window-confirm')
  })

  it('asks main with exactly the unsaved tabs, detached from the store', async () => {
    const store = seed([
      tab({ id: 'saved', isSaved: true }),
      tab({ id: 'dirty', isSaved: false, filename: 'dirty.md', pathname: '/docs/dirty.md' })
    ])
    store.LISTEN_FOR_CLOSE()

    await fireClose()

    const confirm = send().mock.calls.find((c: unknown[]) => c[0] === 'mt::close-window-confirm')
    expect(confirm).toBeTruthy()
    const list = confirm?.[1] as Array<Record<string, unknown>>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'dirty', filename: 'dirty.md', pathname: '/docs/dirty.md' })
    expect(list[0].options).toBeTruthy()
    expect(list[0]).not.toBe(store.tabs[1])
    expect(send().mock.calls.map((c: unknown[]) => c[0])).not.toContain('mt::close-window')
  })

  it('still flushes the session buffer when the buffer write fails', async () => {
    const { sendBufferedState } = await import('@/store/bufferedState')
    vi.mocked(sendBufferedState).mockRejectedValueOnce(new Error('disk full'))
    const store = seed([tab({ isSaved: true })])
    store.LISTEN_FOR_CLOSE()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fireClose()

    expect(error).toHaveBeenCalled()
    expect(send().mock.calls.map((c: unknown[]) => c[0])).toContain('mt::close-window')
  })
})

describe('SET_SAVE_STATUS_WHEN_REMOVE', () => {
  it('marks every tab pointing at the removed path dirty and re-persists the session', () => {
    const store = seed([
      tab({ id: 'a', pathname: '/docs/gone.md' }),
      tab({ id: 'b', pathname: '/docs/gone.md' }),
      tab({ id: 'c', pathname: '/docs/keep.md' })
    ])

    store.SET_SAVE_STATUS_WHEN_REMOVE({ pathname: '/docs/gone.md' })

    expect(store.tabs.map((t) => t.isSaved)).toEqual([false, false, true])
    expect(vi.mocked(debouncedSendBufferedState)).toHaveBeenCalledTimes(1)
  })

  it('does not touch the session buffer when no tab matches', () => {
    const store = seed([tab({ id: 'a', pathname: '/docs/keep.md' })])

    store.SET_SAVE_STATUS_WHEN_REMOVE({ pathname: '/docs/gone.md' })

    expect(store.tabs[0].isSaved).toBe(true)
    expect(vi.mocked(debouncedSendBufferedState)).not.toHaveBeenCalled()
  })
})
