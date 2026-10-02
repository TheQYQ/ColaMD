import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stale read reaching the renderer LAST is unrecoverable: `handleDiskChange`
// (renderer/src/store/contentEvents.ts) only de-duplicates byte-identical content
// and has no order guard, so a saved tab gets rewritten back to older bytes with
// no later event to correct it. chokidar never awaits its async handlers and
// watcher.ts does not await `change()` either, so two events for one file used to
// run as concurrent async functions and `Promise.all([loadMarkdownFile, stat])`
// let the older read win the push.
//
// The fix serializes content-reading work per pathname. These tests pin the
// ordering invariant rather than a timing window: they drive the captured
// chokidar callbacks by hand and resolve the pending loads in reverse creation
// order — the order that used to produce the stale-last push.

type Deferred = { label: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }

// vi.mock factories are hoisted above module-level consts, so every object the
// factories touch must be created inside vi.hoisted.
const h = vi.hoisted(() => {
  const pending: Deferred[] = []
  // Monotonic read counter. It cannot be `pending.length`, because the drain
  // helper pops entries and the next read would then reuse a label.
  const state = { reads: 0 }
  const statMock = vi.fn()
  const captured: Record<string, unknown> = { all: [] as unknown[], last: null }
  return { pending, state, statMock, captured }
})

vi.mock('main_renderer/filesystem/markdown', () => ({
  loadMarkdownFile: () => {
    // Label each read by a monotonic index so a test can tell which event the
    // resolved body belongs to regardless of completion order.
    const label = `READ_${h.state.reads++}`
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<unknown>((_resolve, _reject) => {
      resolve = _resolve
      reject = _reject
    })
    h.pending.push({ label, resolve, reject })
    return promise
  }
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const patched = { ...actual, stat: h.statMock }
  return { ...actual, default: patched, stat: h.statMock }
})

vi.mock('chokidar', () => ({
  default: {
    watch: () => {
      const w: Record<string, unknown> = {}
      w.on = vi.fn(() => w)
      w.close = vi.fn()
      w.add = vi.fn()
      w.unwatch = vi.fn()
      h.captured.last = w
      ;(h.captured.all as unknown[]).push(w)
      return w
    }
  }
}))

// Importing the watcher pulls in the markdown loader, whose encoding detection
// uses the native `ced` addon built for Electron's ABI, not the plain-Node test
// runner. Same reason as watcher-await-write-finish.spec.ts.
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

import Watcher from 'main_renderer/filesystem/watcher'

// Flush microtasks plus one macrotask turn so pending async handlers reach the
// loadMarkdownFile call site. `await` continuations queue as microtasks, so a
// synchronous flush would race the deferred into existence.
const flush = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((_resolve) => {
      setTimeout(_resolve, 0)
    })
  }
}

interface Push {
  channel: string
  payload: Record<string, unknown>
}

const markdownOf = (push: Push): string | undefined =>
  (push.payload as { change?: { data?: { markdown?: string } } }).change?.data?.markdown

const pushOrder = (sent: Push[]): Array<string | undefined> =>
  sent.filter((s) => s.channel === 'mt::update-file').map(markdownOf)

/** Pull one handler off a fake chokidar watcher, failing loudly when absent. */
const registeredHandler = (
  w: Record<string, ReturnType<typeof vi.fn>>,
  event: string
): ((p: string) => Promise<void>) => {
  const call = w.on.mock.calls.find((c) => c[0] === event)
  if (!call) throw new Error(`no ${event} handler registered`)
  return call[1] as (p: string) => Promise<void>
}

describe('watcher per-path serialization of content reads', () => {
  let watcher: Watcher
  let sent: Push[]

  const handlerFor = (event: string): ((p: string) => Promise<void>) =>
    registeredHandler(h.captured.last as Record<string, ReturnType<typeof vi.fn>>, event)

  const startFileWatcher = (pathname: string): void => {
    watcher.watch(
      {
        id: 1,
        webContents: {
          send: vi.fn((c: string, p: unknown) => {
            sent.push({ channel: c, payload: p as Record<string, unknown> })
          })
        }
      } as never,
      pathname,
      'file'
    )
  }

  // Every test uses its own pathname. The queue is module-level and keyed by
  // path, so a test that deliberately leaves a read unresolved would keep that
  // path's chain pending for the rest of the file.

  /**
   * Resolve every pending read, newest-created first, repeating until the
   * pipeline goes quiet. On unfixed code both reads are pending at once, so this
   * completes the SECOND one first and the first one lands last as the stale
   * push. On fixed code the second read does not exist yet when the first is
   * pending, so resolving it releases the queue and creates the next one.
   *
   * Tests that leave a read pending to make an assertion must call this
   * afterwards so the chain settles.
   */
  const drainNewestFirst = async (): Promise<void> => {
    for (let round = 0; round < 6; round++) {
      await flush(2)
      const next = h.pending.pop()
      if (!next) break
      next.resolve({
        markdown: `BODY_OF_${next.label}`,
        filename: 'note.md',
        pathname: '/project/note.md'
      })
    }
    await flush(3)
  }

  beforeEach(() => {
    h.pending.length = 0
    h.state.reads = 0
    // The captured watcher list must be cleared too: tests that register two
    // watchers index into it positionally, so a stale entry from an earlier test
    // would hand them the wrong watcher's handler.
    ;(h.captured.all as unknown[]).length = 0
    h.captured.last = null
    h.statMock.mockReset()
    h.statMock.mockImplementation(async () => ({
      mtimeMs: 1,
      mtime: new Date(1),
      birthtime: new Date(1)
    }))
    sent = []
    const preferences = {
      getItem: vi.fn(() => false),
      getPreferredEol: vi.fn(() => 'lf'),
      getAll: vi.fn(() => ({
        autoGuessEncoding: true,
        trimTrailingNewline: 2,
        autoNormalizeLineEndings: false
      }))
    }
    watcher = new Watcher(preferences as never)
  })

  it('delivers the newer event body last when two changes interleave', async () => {
    startFileWatcher('/project/note-a.md')
    const onChange = handlerFor('change')

    // Two events, same file. Neither call site awaits the watcher work.
    void onChange('/project/note.md')
    await flush(2)
    void onChange('/project/note.md')
    await flush(2)

    await drainNewestFirst()

    const order = pushOrder(sent)
    expect(order.length, 'both changes must be delivered').toBe(2)
    // READ_0 is the first event's read and READ_1 the second's. Serialization
    // must put them in event order, so the last push is the second event's body.
    expect(order).toEqual(['BODY_OF_READ_0', 'BODY_OF_READ_1'])
    expect(order[order.length - 1]).toBe('BODY_OF_READ_1')
  })

  it('does not start the second read before the first has been delivered', async () => {
    startFileWatcher('/project/note-b.md')
    const onChange = handlerFor('change')

    void onChange('/project/note.md')
    await flush(2)
    void onChange('/project/note.md')
    await flush(2)

    // The whole point: one outstanding read per path, not two racing reads.
    expect(h.pending.length, 'reads for one path must be serialized').toBe(1)

    await drainNewestFirst()
  })

  it('keeps different paths concurrent so one large file cannot stall others', async () => {
    // Two single-file watchers, one per path. A directory watcher's `change`
    // returns early after a bare `stat`, so it would not exercise the queue.
    const win = {
      id: 1,
      webContents: {
        send: vi.fn((c: string, p: unknown) => {
          sent.push({ channel: c, payload: p as Record<string, unknown> })
        })
      }
    } as never
    watcher.watch(win, '/project/a.md', 'file')
    watcher.watch(win, '/project/b.md', 'file')

    const handlers = (h.captured.all as unknown[]).map((w) =>
      registeredHandler(w as Record<string, ReturnType<typeof vi.fn>>, 'change')
    )

    void handlers[0]('/project/a.md')
    void handlers[1]('/project/b.md')
    await flush(3)

    // Both reads outstanding at once — a global queue would show 1 here.
    expect(h.pending.length, 'distinct paths must not serialize against each other').toBe(2)

    await drainNewestFirst()
  })

  it('does not let an unsettled read on one path block a different path', async () => {
    // Regression guard for the queue's keying. A per-path chain that leaked or
    // was keyed globally would stall every unrelated change behind one slow
    // file, so this pins that a permanently pending read is path-local.
    const win = {
      id: 1,
      webContents: {
        send: vi.fn((c: string, p: unknown) => {
          sent.push({ channel: c, payload: p as Record<string, unknown> })
        })
      }
    } as never
    watcher.watch(win, '/project/leak.md', 'file')
    watcher.watch(win, '/project/other.md', 'file')
    const handlers = (h.captured.all as unknown[]).map((w) =>
      registeredHandler(w as Record<string, ReturnType<typeof vi.fn>>, 'change')
    )

    // The first path's read is never resolved.
    void handlers[0]('/project/leak.md')
    await flush(2)
    expect(h.pending.length).toBe(1)

    // A different path must still get its read started.
    void handlers[1]('/project/other.md')
    await flush(3)
    expect(h.pending.length, 'a different path must not be blocked').toBe(2)

    await drainNewestFirst()
  })

  it('keeps delivering after one read fails', async () => {
    startFileWatcher('/project/note-c.md')
    const onChange = handlerFor('change')

    void onChange('/project/note.md')
    await flush(2)
    void onChange('/project/note.md')
    await flush(2)

    // Reject the first read: a poisoned queue link would strand the second.
    h.pending[0].reject(new Error('read failed'))
    await flush(2)
    await drainNewestFirst()
    await flush(3)

    expect(pushOrder(sent).length, 'the second change must still be delivered').toBeGreaterThan(0)
  })
})
