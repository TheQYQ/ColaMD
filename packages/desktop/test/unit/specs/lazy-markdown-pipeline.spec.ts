import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLazyMarkdownPipeline, type PipelineEngine } from '@/components/editorWithTabs/lazyMarkdownPipeline'

// A loose record view of a dispatched payload (tests assert via toMatchObject).
type Captured = { [key: string]: unknown }

// M1.2b lazy serialization pipeline — the acceptance property is that a
// keystroke burst performs ZERO full-document serializations, and that the
// serialization happens exactly once per read (flush-on-read), per undo/redo,
// or per typing pause. A missed commit means a save writes stale content, so
// the commit paths are asserted on the dispatch payloads, not on internals.

interface MockEngine extends PipelineEngine {
  calls: Record<string, number>
}

function mockEngine(): MockEngine {
  const calls: Record<string, number> = { flush: 0, serialize: 0 }
  return {
    calls,
    flush() {
      calls.flush++
    },
    getMarkdownLive() {
      calls.serialize++
      return `md#${calls.serialize}`
    },
    getTOC: () => [{ lvl: 1, slug: 'h' }],
    getState: () => ({ blocks: true }),
    getSelection: () => ({ anchor: 1 }),
    getHistory: () => ({ stack: { undo: [], redo: [] } })
  }
}

function makeDeps(engine: MockEngine | null, dispatched: Captured[] = []) {
  let currentId: string | null = 'tab-1'
  return {
    deps: {
      getEngine: () => engine,
      getCurrentId: () => currentId,
      dispatch: (payload: unknown) => {
        dispatched.push({ ...(payload as unknown as Record<string, unknown>) })
      },
      wordCount: (markdown: string) => ({ words: markdown.length }),
      serializeCursor: (selection: unknown) => ({ cursor: selection }),
      makeSyntheticHistory: (id: string, markdown: string) => ({ id, savedContent: markdown }),
      stashEngineHistory: vi.fn(),
      derivedDebounceMs: 120
    },
    setCurrentId: (id: string | null) => {
      currentId = id
    }
  }
}

const USER_EDIT = { op: [{ p: ['x'] }], source: 'user' }
const HISTORY_NAV = { op: [{ p: ['y'] }], source: 'history' }

describe('lazyMarkdownPipeline — keystroke tier does not serialize', () => {
  it('dispatches one edit-tier payload per keystroke with markdown null', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange(USER_EDIT)
    pipeline.onJsonChange(USER_EDIT)
    pipeline.onJsonChange(USER_EDIT)

    expect(engine.calls.serialize).toBe(0) // THE acceptance property
    expect(dispatched).toHaveLength(3)
    for (const payload of dispatched) {
      expect(payload).toMatchObject({ id: 'tab-1', markdown: null, edit: true })
      expect(payload.history).toBeNull()
    }
    expect(pipeline.hasPendingCommit).toBe(true)
  })

  it('commits nothing for identity ops and non-user sources', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange({ op: null, source: 'user' }) // IME compose-away
    pipeline.onJsonChange({ op: [{ p: ['x'] }], source: 'api' }) // setContent/replaceContent

    expect(engine.calls.serialize).toBe(0)
    expect(dispatched).toHaveLength(0)
    expect(pipeline.hasPendingCommit).toBe(false)
  })
})

describe('lazyMarkdownPipeline — flush-on-read commits exactly once', () => {
  it('flushes pending ops and serializes once, then stays quiet', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange(USER_EDIT)
    pipeline.flushActive()

    expect(engine.calls.flush).toBe(1)
    expect(engine.calls.serialize).toBe(1)
    expect(pipeline.hasPendingCommit).toBe(false)

    // Repeated flush-on-read (e.g. save + crash buffer + compare in one turn)
    // must NOT serialize again.
    pipeline.flushActive()
    pipeline.flushActive()
    expect(engine.calls.serialize).toBe(1)

    const commit = dispatched[1]
    expect(commit).toMatchObject({
      id: 'tab-1',
      markdown: 'md#1',
      history: { id: 'tab-1', savedContent: 'md#1' },
      cursor: { cursor: { anchor: 1 } }
    })
    expect(commit.edit).toBeUndefined()
  })

  it('flushActive with nothing pending never serializes', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const pipeline = createLazyMarkdownPipeline({ ...deps, dispatch: () => {} })

    pipeline.flushActive()

    expect(engine.calls.flush).toBe(1)
    expect(engine.calls.serialize).toBe(0)
  })

  it('flushActive without an engine is a no-op', () => {
    const { deps } = makeDeps(null)
    const pipeline = createLazyMarkdownPipeline({ ...deps, dispatch: () => {} })
    expect(() => pipeline.flushActive()).not.toThrow()
  })
})

describe('lazyMarkdownPipeline — undo/redo resolves clean/dirty immediately', () => {
  it('commits (serialize + hash) synchronously on a history-sourced change', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    // A pending keystroke followed by undo: the commit must run NOW — the
    // undo may have landed back on the saved content (Phase G — G6).
    pipeline.onJsonChange(USER_EDIT)
    pipeline.onJsonChange(HISTORY_NAV)

    expect(engine.calls.serialize).toBe(1)
    expect(pipeline.hasPendingCommit).toBe(false)
    expect(dispatched[1]).toMatchObject({ id: 'tab-1', markdown: 'md#1' })
  })
})

describe('lazyMarkdownPipeline — pause tier collapses the burst', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('one serialization 120ms after the last keystroke carries TOC/wordCount/blocks', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange(USER_EDIT)
    vi.advanceTimersByTime(50)
    pipeline.onJsonChange(USER_EDIT) // re-arms the debounce
    vi.advanceTimersByTime(119)
    expect(engine.calls.serialize).toBe(0)
    vi.advanceTimersByTime(1)

    expect(engine.calls.serialize).toBe(1)
    expect(pipeline.hasPendingCommit).toBe(false)
    expect(dispatched[2]).toMatchObject({
      id: 'tab-1',
      markdown: 'md#1',
      wordCount: { words: 4 },
      toc: [{ lvl: 1, slug: 'h' }],
      blocks: { blocks: true },
      history: { savedContent: 'md#1' }
    })
  })

  it('drops the pause flush when the tab switched inside the window', () => {
    const engine = mockEngine()
    const { deps, setCurrentId } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange(USER_EDIT) // scheduled for tab-1
    setCurrentId('tab-2') // tab switch before the 120ms fire
    vi.advanceTimersByTime(200)

    // The NEW document's content must never be committed under the OLD id.
    expect(dispatched).toHaveLength(1) // only the keystroke-tier edit
    expect(engine.calls.serialize).toBe(0)
  })

  it('markBaseline clears pending commits and the pause timer', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const dispatched: Captured[] = []
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      dispatch: (p) => {
        dispatched.push({ ...(p as unknown as Record<string, unknown>) })
      }
    })

    pipeline.onJsonChange(USER_EDIT)
    pipeline.markBaseline() // e.g. setContent replaced the document
    vi.advanceTimersByTime(200)
    pipeline.flushActive()

    expect(dispatched).toHaveLength(1) // only the edit-tier notification
    expect(engine.calls.serialize).toBe(0)
  })

  it('dispose cancels the pause timer (component teardown)', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const pipeline = createLazyMarkdownPipeline({ ...deps, dispatch: () => {} })

    pipeline.onJsonChange(USER_EDIT)
    pipeline.dispose()
    vi.advanceTimersByTime(200)

    expect(engine.calls.serialize).toBe(0)
  })
})

describe('lazyMarkdownPipeline — engine history stash', () => {
  it('stashes the engine history for every json-change (tab-switch restore)', () => {
    const engine = mockEngine()
    const { deps } = makeDeps(engine)
    const stash = vi.fn()
    const pipeline = createLazyMarkdownPipeline({
      ...deps,
      stashEngineHistory: stash,
      dispatch: () => {}
    })

    pipeline.onJsonChange(USER_EDIT)
    pipeline.onJsonChange({ op: null, source: 'user' })
    pipeline.onJsonChange({ op: [{ p: ['x'] }], source: 'api' })

    expect(stash).toHaveBeenCalledTimes(3)
    expect(stash).toHaveBeenCalledWith('tab-1', { stack: { undo: [], redo: [] } })
  })
})
