import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLazyMarkdownPipeline,
  type PipelineEngine
} from '@/components/editorWithTabs/lazyMarkdownPipeline'

// Root-cause test for the mac-side `list-indent.spec.ts:91` failure.
//
// The engine serializes only its FLUSHED document: ops queued since the last
// `flush()` are invisible to `getMarkdownLive()`. The debounced (120 ms) commit in
// the lazy pipeline called `getMarkdownLive()` without flushing first, while
// still clearing `pendingMarkdownCommit`. So a structural edit whose op was still
// queued at the debounce tick got a stale snapshot committed *and* marked clean --
// after which every flush-on-read (entering source mode, saving) skips the commit
// and reads that stale markdown. A save then writes the document without that
// edit: silent content loss, and in the E2E case a flat `- item one\n- item two`
// where the DOM already shows the nested list.

interface QueueEngine extends PipelineEngine {
  /** The markdown the engine would serialize right now (pre-flush). */
  queue: string[]
  flushes: number
}

function engineWithQueue(): QueueEngine {
  let applied = '- item one\n- item two'
  const e: QueueEngine = {
    queue: [],
    flushes: 0,
    flush() {
      e.flushes++
      applied = applied.replace('\n- item two', '\n  - item two')
    },
    getMarkdownLive: () => applied,
    getTOC: () => [],
    getState: () => ({}),
    getSelection: () => null,
    getHistory: () => ({ stack: { undo: [], redo: [] } })
  }
  return e
}

const USER_EDIT = { op: [{ p: ['x'] }], source: 'user' }

describe('lazy pipeline: the debounced commit must flush the engine first', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits the post-flush markdown when the debounce fires with ops queued', () => {
    const engine = engineWithQueue()
    const dispatched: Array<Record<string, unknown>> = []
    const pipeline = createLazyMarkdownPipeline({
      getEngine: () => engine,
      getCurrentId: () => 'tab-1',
      dispatch: (p: unknown) => dispatched.push(p as Record<string, unknown>),
      wordCount: (md: string) => ({ words: md.split(/\s+/).length }),
      serializeCursor: (s: unknown) => ({ cursor: s }),
      makeSyntheticHistory: (id: string, md: string) => ({ id, savedContent: md }),
      stashEngineHistory: () => {},
      derivedDebounceMs: 120
    })

    pipeline.onJsonChange(USER_EDIT)
    vi.advanceTimersByTime(200)

    expect(engine.flushes).toBeGreaterThan(0)
    const committed = dispatched.filter((p) => typeof p.markdown === 'string')
    expect(committed.length).toBe(1)
    expect(committed[0].markdown).toBe('- item one\n  - item two')
  })

  it('leaves no stale snapshot behind for a later flush-on-read', () => {
    const engine = engineWithQueue()
    const dispatched: Array<Record<string, unknown>> = []
    const pipeline = createLazyMarkdownPipeline({
      getEngine: () => engine,
      getCurrentId: () => 'tab-1',
      dispatch: (p: unknown) => dispatched.push(p as Record<string, unknown>),
      wordCount: (md: string) => ({ words: md.split(/\s+/).length }),
      serializeCursor: (s: unknown) => ({ cursor: s }),
      makeSyntheticHistory: (id: string, md: string) => ({ id, savedContent: md }),
      stashEngineHistory: () => {},
      derivedDebounceMs: 120
    })

    pipeline.onJsonChange(USER_EDIT)
    vi.advanceTimersByTime(200)
    // Typing has settled, so the flag is legitimately clear; entering source mode
    // or saving now reads the last committed snapshot -- it must be the nested one.
    expect(pipeline.hasPendingCommit).toBe(false)
    pipeline.flushActive()
    const committed = dispatched
      .filter((p) => typeof p.markdown === 'string')
      .map((p) => p.markdown as string)
    expect(committed[committed.length - 1]).toBe('- item one\n  - item two')
  })
})
