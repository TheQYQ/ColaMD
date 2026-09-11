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
import bus from '@/bus'

// #3803: the store snapshots `currentFile.markdown` (refreshed only on the
// engine's deferred rAF `json-change`) to send to the main process. A keystroke
// typed in the same frame as Cmd+S was therefore dropped from the saved file.
// The save/move/rename paths now emit `flush-active-editor` first, which the
// editor synchronously commits into `currentFile.markdown` before it is read.
//
// The bug lives at the `const { …, markdown } = this.currentFile` READ, which
// sits between the flush and the send — so an emit-order assertion (flush < send)
// alone would still pass if a regression moved the flush past the read. These
// tests instead wire a real `flush-active-editor` listener that commits the
// pending keystroke (mirroring editor.vue → `editor.flush()` → `json-change` →
// LISTEN_FOR_CONTENT_CHANGE) and assert the SENT PAYLOAD carries it: a flush
// moved after the read would send the stale snapshot and fail here.

const STALE = 'hello' // what the pre-flush snapshot holds
const FLUSHED = 'hello world!' // the last keystroke the editor commits on flush
const MARKDOWN_ARG = 4 // send(channel, id, filename, pathname, markdown, …)

function seedCurrentFile(
  store: ReturnType<typeof useEditorStore>,
  overrides: Record<string, unknown> = {}
) {
  store.currentFile = {
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: STALE,
    isSaved: false,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2,
    ...overrides
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Mirror editor.vue's listener: commit the pending keystroke into the store on
// flush. Returns a detach fn (the bus is a module singleton — listeners leak
// across tests otherwise).
function onFlushCommit(store: ReturnType<typeof useEditorStore>) {
  const handler = () => {
    if (store.currentFile) store.currentFile.markdown = FLUSHED
  }
  bus.on('flush-active-editor', handler)
  return () => bus.off('flush-active-editor', handler)
}

// Global invocation order of a given emitted event, located by event name (not
// array position) so an unrelated earlier emit can't mask a moved flush.
function emitOrderOf(emitSpy: ReturnType<typeof vi.spyOn>, event: string): number | undefined {
  const i = emitSpy.mock.calls.findIndex((c: unknown[]) => c[0] === event)
  return i === -1 ? undefined : emitSpy.mock.invocationCallOrder[i]
}

describe('editor store — flush pending edits before saving (#3803)', () => {
  let detach: (() => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    detach?.()
    detach = undefined
  })

  it('FILE_SAVE sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('FILE_SAVE_AS sends the flushed markdown, not the stale pre-flush snapshot', () => {
    const store = useEditorStore()
    seedCurrentFile(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.FILE_SAVE_AS()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save-as')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // MOVE_FILE_TO / RESPONSE_FOR_RENAME only transmit `markdown` in their untitled
  // (no-pathname) branch, which reuses `mt::response-file-save` — that is where
  // the flush actually matters, so assert the payload there too.
  it('MOVE_FILE_TO (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.MOVE_FILE_TO()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('RESPONSE_FOR_RENAME (untitled) sends the flushed markdown', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '' })
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.RESPONSE_FOR_RENAME()

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  // The existing-file rename branch emits 'rename' (no markdown payload); guard
  // that the flush still precedes it so it can't be silently dropped later.
  it('RESPONSE_FOR_RENAME (existing file) flushes before emitting rename', () => {
    const store = useEditorStore()
    seedCurrentFile(store, { pathname: '/tmp/note.md' })
    const emitSpy = vi.spyOn(bus, 'emit')

    store.RESPONSE_FOR_RENAME()

    const flushOrder = emitOrderOf(emitSpy, 'flush-active-editor')
    const renameOrder = emitOrderOf(emitSpy, 'rename')
    expect(flushOrder).toBeDefined()
    expect(renameOrder).toBeDefined()
    expect(flushOrder as number).toBeLessThan(renameOrder as number)
  })
})

// M1.2b audit (packages/muya/docs/tabMarkdown-readers.md R5/R6/R7/R9): the same
// stale-read bug #3803 fixed for the four explicit save paths still existed on
// four more read paths. Same testing strategy: a real `flush-active-editor`
// listener commits the pending keystroke, and the assertion is on the SENT or
// SNAPSHOT payload.
describe('editor store — flush pending edits on the remaining read paths', () => {
  let detach: (() => void) | undefined

  const seedTabs = (store: ReturnType<typeof useEditorStore>) => {
    seedCurrentFile(store)
    // The tab in the tabs list must be the SAME object as currentFile — that is
    // how the store reads back the flushed content via the tab reference.
    store.tabs = [store.currentFile as never]
    store.tabIdToIndex = { 'tab-1': 0 }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    detach?.()
    detach = undefined
    vi.useRealTimers()
    delete (window as unknown as { versionHistory?: unknown }).versionHistory
  })

  it('ASK_FOR_SAVE_ALL sends the flushed markdown for the active tab', () => {
    const store = useEditorStore()
    seedTabs(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.ASK_FOR_SAVE_ALL(false)

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::save-tabs')
    expect(call).toBeDefined()
    expect((call?.[1] as Array<{ markdown: string }>)[0].markdown).toBe(FLUSHED)
  })

  it('HANDLE_AUTO_SAVE timer saves the markdown as of fire time, not schedule time', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    seedTabs(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.HANDLE_AUTO_SAVE({
      id: 'tab-1',
      filename: 'note.md',
      pathname: '/tmp/note.md',
      markdown: STALE, // captured at schedule time
      options: {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    // A keystroke lands after scheduling, still unflushed when the timer fires.
    if (store.currentFile) store.currentFile.markdown = STALE
    vi.advanceTimersByTime(60_000)

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    expect(call?.[MARKDOWN_ARG]).toBe(FLUSHED)
  })

  it('FORCE_CLOSE_TAB snapshots the flushed markdown (Session End)', async() => {
    const store = useEditorStore()
    seedTabs(store)
    detach = onFlushCommit(store)
    const saveSnapshot = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { versionHistory?: unknown }).versionHistory = { save: saveSnapshot }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tab = store.tabs[0] as any
    tab.pathname = '/tmp/note.md'

    store.FORCE_CLOSE_TAB(tab)

    expect(saveSnapshot).toHaveBeenCalledTimes(1)
    expect(saveSnapshot.mock.calls[0][0]).toMatchObject({
      pathname: '/tmp/note.md',
      markdown: FLUSHED
    })
  })

  it('CLOSE_UNSAVED_TAB sends the flushed markdown', () => {
    const store = useEditorStore()
    seedTabs(store)
    detach = onFlushCommit(store)
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.CLOSE_UNSAVED_TAB(store.tabs[0] as never)

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::save-and-close-tabs')
    expect(call).toBeDefined()
    expect((call?.[1] as Array<{ markdown: string }>)[0].markdown).toBe(FLUSHED)
  })
})
