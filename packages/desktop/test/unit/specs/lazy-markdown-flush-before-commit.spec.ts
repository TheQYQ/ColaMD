import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLazyMarkdownPipeline,
  type PipelineEngine
} from '@/components/editorWithTabs/lazyMarkdownPipeline'

// Root-cause tests for the mac-side `list-indent.spec.ts:91` failure. Two
// separate defects, both "a read gets the document as it was before the edit":
//
// 1. The debounced (120 ms) commit called `getMarkdownLive()` without flushing
//    first, while still clearing `pendingMarkdownCommit` -- the engine serializes
//    only its flushed state. Every later flush-on-read then saw a clean flag and
//    reused that stale snapshot, so a save would write the document without the
//    edit.
// 2. The source-mode read was *gated* on `hasPendingCommit` at the call site. That
//    flag is set by `json-change`, which the engine only emits when it applies the
//    next animation frame's op batch (muya/src/state/index.ts:252-272) -- and
//    entering source mode reads inside the frame the keystroke happened in. So the
//    gate hid the edit it was meant to catch: the flush never ran, the source
//    editor mounted on stale text, and the exit wrote that text back. On Windows
//    the frame wins the race; on mac 8 of 9 source-mode entries saw
//    `pending=false` (one flush ran, out of nine).

interface QueueEngine extends PipelineEngine {
  flushes: number
}

/**
 * A stand-in for the real engine. `queued` means an edit sits in the op queue:
 * the document only moves when `flush()` applies it. `report` models the
 * `json-change` the engine fires from inside that flush, so an edit can already
 * be in the document before the pipeline has been told about it.
 */
function engineWithQueue({
  queued = true,
  report
}: {
  queued?: boolean
  report?: () => void
} = {}): QueueEngine {
  let applied = '- item one\n- item two'
  const e: QueueEngine = {
    flushes: 0,
    flush() {
      e.flushes++
      if (!queued) return
      applied = applied.replace('\n- item two', '\n  - item two')
      report?.()
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

function buildPipeline(engine: QueueEngine): {
  pipeline: ReturnType<typeof createLazyMarkdownPipeline>
  committed: () => unknown[]
} {
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
  return {
    pipeline,
    committed: () =>
      dispatched.filter((p) => typeof p.markdown === 'string').map((p) => p.markdown as string)
  }
}

describe('lazy pipeline: a read must never return the pre-edit document', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits the post-flush markdown when the debounce fires with ops queued', () => {
    const engine = engineWithQueue()
    const { pipeline, committed } = buildPipeline(engine)

    pipeline.onJsonChange(USER_EDIT)
    vi.advanceTimersByTime(200)

    expect(engine.flushes).toBeGreaterThan(0)
    expect(committed()).toEqual(['- item one\n  - item two'])
  })

  it('leaves no stale snapshot behind for a later flush-on-read', () => {
    const engine = engineWithQueue()
    const { pipeline, committed } = buildPipeline(engine)

    pipeline.onJsonChange(USER_EDIT)
    vi.advanceTimersByTime(200)
    expect(pipeline.hasPendingCommit).toBe(false)
    pipeline.flushActive()
    expect(committed().at(-1)).toBe('- item one\n  - item two')
  })

  it('commits an edit the engine has not reported yet (the mac ordering)', () => {
    // The keystroke sits in the engine's queue; its `json-change` has not been
    // delivered, so the dirty flag the read used to be gated on is legitimately
    // false. `flushActive()` has to ask the engine, not the flag: applying the
    // queue is what reports the edit, and the post-flush check then sees it.
    let notify = (): void => {}
    const engine = engineWithQueue({ report: () => notify() })
    const { pipeline, committed } = buildPipeline(engine)
    notify = () => pipeline.onJsonChange(USER_EDIT)

    expect(pipeline.hasPendingCommit).toBe(false)
    pipeline.flushActive()
    expect(committed().at(-1)).toBe('- item one\n  - item two')
  })

  it('dispatches no snapshot when the engine reports nothing', () => {
    // The other half of why the gate was removed instead of the commit being made
    // unconditional: a flush with an empty queue must not serialize, or every
    // visit into source mode would rewrite `tab.markdown` with the engine's own
    // serialization -- which is NOT byte-identical to the file it loaded
    // (that is what `all-blocks-roundtrip.spec.ts` locks).
    const engine = engineWithQueue({ queued: false })
    const { pipeline, committed } = buildPipeline(engine)

    pipeline.flushActive()
    expect(committed()).toEqual([])
  })
})
