import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// O12(18): the two caret/format actions. Neither had a test anywhere, and both
// are small enough that the extraction they would have justified is not worth a
// new module — so this commit closes the coverage and stops there.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      colamd?: { env?: { windowId?: number } }
      path?: { sep: string; dirname: (p: string) => string; basename: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  // `store/editor` pulls `config.ts`, which reads `window.path.sep` at module load.
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1)
  }
  w.window.colamd ??= { env: { windowId: 7 } }
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

const send = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.send)

const tab = (id: string): IFileState =>
  ({
    id,
    filename: `${id}.md`,
    pathname: `/docs/${id}.md`,
    markdown: `# ${id}\n`,
    isSaved: true,
    history: {},
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: null
  }) as unknown as IFileState

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('PERSIST_CURSOR', () => {
  const seeded = () => {
    const store = useEditorStore()
    store.tabs = [tab('a'), tab('b')]
    store.currentFile = store.tabs[0]
    store.updateTabIdToIndex()
    return store
  }

  it('stores the caret on the addressed tab and leaves the others alone', () => {
    const store = seeded()

    store.PERSIST_CURSOR('b', { start: { row: 2, column: 1 } })

    expect(store.tabs[1].cursor).toEqual({ start: { row: 2, column: 1 } })
    expect(store.tabs[0].cursor).toBeNull()
  })

  it('ignores a call without an id or without a caret', () => {
    const store = seeded()

    store.PERSIST_CURSOR('', { row: 0 })
    store.PERSIST_CURSOR('a', null)

    expect(store.tabs[0].cursor).toBeNull()
    expect(store.tabs[1].cursor).toBeNull()
  })

  it('drops the caret when the tab it was meant for is already closed', () => {
    const store = seeded()

    store.PERSIST_CURSOR('gone', { row: 3 })

    expect(store.tabs.every((t) => t.cursor === null)).toBe(true)
  })
})

describe('SELECTION_FORMATS', () => {
  it('keys html-tag formats by their tag so the menu map can find them', () => {
    const store = useEditorStore()

    store.SELECTION_FORMATS([{ type: 'strong' }, { type: 'html_tag', tag: 'u' }] as never)

    expect(store.selectionFormatState).toEqual({ strong: true, u: true })
    const call = send().mock.calls.find((c: unknown[]) => c[0] === 'mt::update-format-menu')
    expect(call?.[1]).toBe(7)
    expect(call?.[2]).toEqual({ strong: true, u: true })
  })

  it('still reports an empty selection so the menu can clear itself', () => {
    const store = useEditorStore()
    store.selectionFormatState = { strong: true }

    store.SELECTION_FORMATS([])

    expect(store.selectionFormatState).toEqual({})
    expect(send().mock.calls.some((c: unknown[]) => c[0] === 'mt::update-format-menu')).toBe(true)
  })
})
