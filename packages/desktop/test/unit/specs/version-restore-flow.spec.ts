import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// `@/store/editor` reads `window.path` at module load and `window.electron` /
// `window.versionHistory` at runtime; stub those surfaces before the hoisted
// imports run. `save` resolves with its argument, mirroring the main-process
// store's "return the stored snapshot" behavior.
const vhStub = vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
      versionHistory?: { save: (s: unknown) => Promise<unknown> }
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
  const save = vi.fn((s: unknown) => Promise.resolve(s))
  w.window.versionHistory ??= { save }
  return { save }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
// The session-buffer write rides along with both actions under test; stub it
// so assertions see the snapshot/restore bookkeeping, not a debounce timer.
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve())
}))

import { useEditorStore } from '@/store/editor'
import bus from '@/bus'

const saveMock = vhStub.save
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const currentFile = (pathname: string, markdown: string): IFileState =>
  ({
    id: 'a',
    filename: 'a.md',
    pathname,
    markdown,
    isSaved: true,
    history: {},
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: null
  }) as unknown as IFileState

beforeEach(() => {
  // `bus` is a module singleton; a spy left installed by a failing assertion
  // would keep collecting calls into the next test.
  vi.restoreAllMocks()
  saveMock.mockClear()
  setActivePinia(createPinia())
  window.DIRNAME = ''
})

describe('SAVE_VERSION_SNAPSHOT', () => {
  it('sends a snapshot for the current file and announces it on the bus', async () => {
    const store = useEditorStore()
    store.currentFile = currentFile('/docs/a.md', '# a')

    const emitSpy = vi.spyOn(bus, 'emit')
    store.SAVE_VERSION_SNAPSHOT('Manual Save')
    await flushMicrotasks()

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock.mock.calls[0][0]).toMatchObject({
      pathname: '/docs/a.md',
      markdown: '# a',
      label: 'Manual Save'
    })
    expect(emitSpy).toHaveBeenCalledWith('version-snapshot-saved')
  })

  it('uses the markdown override as the snapshot body', async () => {
    const store = useEditorStore()
    store.currentFile = currentFile('/docs/a.md', '# a')

    store.SAVE_VERSION_SNAPSHOT('Pre-restore Backup', '# restored')
    await flushMicrotasks()

    expect(saveMock.mock.calls[0][0]).toMatchObject({ markdown: '# restored' })
  })

  it('does nothing without a current file or a pathname', async () => {
    const store = useEditorStore()
    store.currentFile = null
    store.SAVE_VERSION_SNAPSHOT('Manual Save')

    store.currentFile = currentFile('/docs/a.md', '# a')
    store.currentFile.pathname = ''
    store.SAVE_VERSION_SNAPSHOT('Manual Save')

    expect(saveMock).not.toHaveBeenCalled()
  })
})

describe('LISTEN_FOR_VERSION_RESTORE', () => {
  it('writes the restored content into the matching tab', async () => {
    const store = useEditorStore()
    store.currentFile = currentFile('/docs/a.md', '# a')
    store.LISTEN_FOR_VERSION_RESTORE()

    const emitSpy = vi.spyOn(bus, 'emit')
    window.dispatchEvent(
      new CustomEvent('version-history:restore', {
        detail: { markdown: '# restored body', pathname: '/docs/a.md' }
      })
    )
    await flushMicrotasks()

    expect(store.currentFile?.markdown).toBe('# restored body')
    expect(store.currentFile?.isSaved).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({ id: 'a', markdown: '# restored body' })
    )
    // The pre-restore state is snapshotted before it gets overwritten.
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Pre-restore Backup', markdown: '# restored body' })
    )
  })

  it('ignores restore events for a different pathname', async () => {
    const store = useEditorStore()
    store.currentFile = currentFile('/docs/a.md', '# a')
    store.LISTEN_FOR_VERSION_RESTORE()

    const emitSpy = vi.spyOn(bus, 'emit')
    window.dispatchEvent(
      new CustomEvent('version-history:restore', {
        detail: { markdown: '# other file', pathname: '/docs/other.md' }
      })
    )
    await flushMicrotasks()

    expect(store.currentFile?.markdown).toBe('# a')
    expect(store.currentFile?.isSaved).toBe(true)
    expect(emitSpy).not.toHaveBeenCalledWith('file-changed', expect.anything())
    expect(saveMock).not.toHaveBeenCalled()
  })
})
