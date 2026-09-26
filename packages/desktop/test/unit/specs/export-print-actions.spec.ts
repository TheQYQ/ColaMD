import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// O12(20): the export/print cluster. `EXPORT`'s title derivation is already
// pinned in `editor-store-anchor.spec.ts`; what is missing is the rest of the
// round trip — which heading entries the scan is allowed to look at, what the
// optional payload fields collapse to, and the two channels main answers on.
// The confirm-toast case matters most: revealing the file in the folder is what
// the user clicked for, and dismissing the toast must stay a silent "no".

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        dirname: (p: string) => string
        basename: (p: string) => string
      }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
        shell: { showItemInFolder: (p: string) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1)
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: vi.fn() },
    shell: { showItemInFolder: vi.fn() }
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
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

const send = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.send)
const on = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.on)
const reveal = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.shell.showItemInFolder)

/** The callback the store handed `ipcRenderer.on` for `channel`, if any. */
const handlerFor = (channel: string): ((...args: never[]) => unknown) | undefined =>
  on()
    .mock.calls.filter((c: unknown[]) => c[0] === channel)
    .map((c: unknown[]) => c[1] as (...args: never[]) => unknown)
    .pop()

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const seeded = (): ReturnType<typeof useEditorStore> => {
  const store = useEditorStore()
  store.currentFile = {
    filename: 'notes.md',
    pathname: '/x/notes.md'
  } as unknown as typeof store.currentFile
  return store
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('EXPORT payload', () => {
  it('never looks past the first six headings for a title', () => {
    const store = seeded()
    store.listToc = [
      { lvl: 3, content: 'Third' },
      { lvl: 3, content: 'Third again' },
      { lvl: 3, content: 'Third again' },
      { lvl: 3, content: 'Third again' },
      { lvl: 3, content: 'Third again' },
      { lvl: 3, content: 'Third again' },
      { lvl: 1, content: 'Seventh, out of reach' }
    ]

    store.EXPORT({ type: 'pdf', pageOptions: {} })

    expect(send().mock.calls[0][1]).toMatchObject({ title: 'Third' })
  })

  it('carries the binary payload as-is and blanks the fields that were not given', () => {
    const store = seeded()
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

    store.EXPORT({ type: 'docx', bytes })

    const [, payload] = send().mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.bytes).toBe(bytes)
    expect(payload.content).toBe('')
    expect(payload.markdown).toBe('')
    expect(payload.pageOptions).toEqual({})
  })

  it('hands the raw markdown to the pandoc formats without inventing HTML', () => {
    const store = seeded()

    store.EXPORT({ type: 'epub', markdown: '# raw\n' })

    const [, payload] = send().mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.markdown).toBe('# raw\n')
    expect(payload.content).toBe('')
    expect(payload.bytes).toBeUndefined()
  })
})

describe('PRINT_RESPONSE', () => {
  it('is a bare ping on the response channel', () => {
    const store = useEditorStore()

    store.PRINT_RESPONSE()

    expect(send()).toHaveBeenCalledTimes(1)
    expect(send().mock.calls[0]).toEqual(['mt::response-print'])
  })
})

describe('LISTEN_FOR_EXPORT_SUCCESS', () => {
  it('names the exported file and reveals it once the toast is confirmed', async () => {
    vi.mocked(notice.notify).mockResolvedValue(undefined)
    const store = useEditorStore()
    store.LISTEN_FOR_EXPORT_SUCCESS()

    const handler = handlerFor('mt::export-success')
    expect(handler).toBeTruthy()
    expect(on().mock.calls.filter((c: unknown[]) => c[0] === 'mt::export-success')).toHaveLength(1)
    ;(handler as (e: unknown, payload: unknown) => void)(
      {},
      { type: 'pdf', filePath: '/out/report.pdf' }
    )
    await settle()

    expect(notice.notify).toHaveBeenCalledTimes(1)
    expect(notice.notify).toHaveBeenCalledWith({
      title: 'Exported successfully',
      message: 'Exported "report.pdf" successfully!',
      showConfirm: true
    })
    expect(reveal()).toHaveBeenCalledWith('/out/report.pdf')
  })

  it('leaves the folder alone when the user dismisses the toast', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    vi.mocked(notice.notify).mockRejectedValue(undefined)
    const store = useEditorStore()
    store.LISTEN_FOR_EXPORT_SUCCESS()

    const handler = handlerFor('mt::export-success')
    ;(handler as (e: unknown, payload: unknown) => void)(
      {},
      { type: 'pdf', filePath: '/out/report.pdf' }
    )
    await settle()

    expect(reveal()).not.toHaveBeenCalled()
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })

  it('still reports when main sends a payload without a path', async () => {
    vi.mocked(notice.notify).mockResolvedValue(undefined)
    const store = useEditorStore()
    store.LISTEN_FOR_EXPORT_SUCCESS()

    const handler = handlerFor('mt::export-success')
    expect(() => {
      ;(handler as (e: unknown) => void)({})
    }).not.toThrow()
    await settle()

    expect(notice.notify).toHaveBeenCalledTimes(1)
  })
})

describe('LISTEN_FOR_PRINT_SERVICE_CLEARUP', () => {
  it('forwards the teardown to the editor so it can release the print service', async () => {
    const emit = vi.spyOn(bus, 'emit')
    const store = useEditorStore()
    store.LISTEN_FOR_PRINT_SERVICE_CLEARUP()

    const handler = handlerFor('mt::print-service-clearup')
    expect(handler).toBeTruthy()
    ;(handler as () => void)()

    expect(emit.mock.calls.some((c: unknown[]) => c[0] === 'print-service-clearup')).toBe(true)
  })
})
