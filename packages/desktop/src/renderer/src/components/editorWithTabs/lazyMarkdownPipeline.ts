// M1.2b lazy markdown serialization pipeline.
//
// PR #19 left two full-document operations on the keystroke path: the
// `getMarkdownLive()` serialization (~59ms on a 1MB document) and the
// synthetic history FNV content hash. Neither is needed to keep the save/dirty
// bookkeeping correct on every keystroke — they are only needed when markdown
// is actually READ (save / export / crash buffer / external-change compare) or
// when an undo/redo makes clean-vs-dirty uncertain. The pipeline therefore
// splits the engine's `json-change` reaction into three tiers:
//
// - keystroke tier (source 'user', real op): mark the tab dirty and re-arm
//   auto-save. NO serialization, NO hash — O(1) per keystroke.
// - undo/redo tier (source 'history'): undo may land the content back on the
//   saved snapshot, and clean-vs-dirty MUST be resolved now (Phase G — G6), so
//   serialize + hash + full commit immediately.
// - debounced pause tier (~120ms after the last keystroke): one serialization
//   feeding markdown + hash + TOC + wordCount + blocks in a single full commit.
//   This also re-freshens `tab.markdown` so later reads are usually free.
//
// `flushActive()` is the flush-on-read primitive: every consumer that reads
// markdown (the store's `flushActiveEditor()` → bus 'flush-active-editor')
// goes through it. It applies the engine's pending ops and, if a keystroke has
// not been committed yet, serializes exactly once. Correctness contract: a
// missed commit means a save writes stale content, so EVERY exit path from the
// active document (save, close, switch, source-mode entry, crash buffer) must
// route through `flushActive()` or `markBaseline()`.
//
// Sources (see muya history): 'user' = real edits (lazy tier), 'history' =
// undo/redo replay (immediate commit), 'api' = setContent/replaceContent
// baseline swaps (immediate commit WITHOUT the dirty flag — the store's hash
// comparison decides cleanliness, which is what lets an undo land back on
// programmatically-installed content and read clean). Identity ops
// (compose-away, e.g. IME) carry a null op — content did not change.

export interface PipelineEngine {
  flush(): void
  getMarkdownLive(): string
  getTOC(): unknown[]
  getState(): unknown
  getSelection(): unknown
  getHistory(): unknown
}

export interface PipelineDispatchPayload {
  id: string
  markdown: string | null
  edit?: boolean
  wordCount?: unknown | null
  cursor?: unknown | null
  history?: unknown | null
  toc?: unknown | null
  blocks?: unknown | null
}

export interface LazyMarkdownPipelineDeps {
  getEngine: () => PipelineEngine | null | undefined
  getCurrentId: () => string | null | undefined
  dispatch: (payload: PipelineDispatchPayload) => void
  wordCount: (markdown: string) => unknown
  serializeCursor: (selection: unknown) => unknown
  makeSyntheticHistory: (id: string, markdown: string) => unknown
  stashEngineHistory: (id: string, history: unknown) => void
  derivedDebounceMs?: number
}

export function createLazyMarkdownPipeline(deps: LazyMarkdownPipelineDeps) {
  // True while the live engine holds keystrokes that no serialized snapshot
  // represents yet. Cleared by every commit below.
  let pendingMarkdownCommit = false
  let pendingDerived: { id: string } | null = null
  let derivedTimer: ReturnType<typeof setTimeout> | null = null

  // Serialize the current document once and commit the full snapshot. Runs
  // only while the engine's document still belongs to `getCurrentId()`.
  const commitPendingMarkdown = (): void => {
    const engine = deps.getEngine()
    const id = deps.getCurrentId()
    if (!engine || !id) return
    const markdown = engine.getMarkdownLive()
    pendingMarkdownCommit = false
    deps.dispatch({
      id,
      markdown,
      wordCount: null,
      cursor: deps.serializeCursor(engine.getSelection()),
      history: deps.makeSyntheticHistory(id, markdown),
      toc: null,
      blocks: null
    })
  }

  const flushDerivedState = (): void => {
    derivedTimer = null
    if (!pendingDerived) return
    const { id } = pendingDerived
    pendingDerived = null
    const engine = deps.getEngine()
    // The debounce can outlive its tab: a switch inside the window must not
    // commit the NEW document's content under the OLD tab's id.
    if (!engine || id !== deps.getCurrentId()) return
    const markdown = engine.getMarkdownLive()
    pendingMarkdownCommit = false
    deps.dispatch({
      id,
      markdown,
      wordCount: deps.wordCount(markdown),
      cursor: null,
      history: deps.makeSyntheticHistory(id, markdown),
      toc: engine.getTOC(),
      blocks: engine.getState()
    })
  }

  return {
    // True while a keystroke is waiting to be serialized. Exposed for
    // assertions and for callers deciding between commit and baseline-reset.
    get hasPendingCommit() {
      return pendingMarkdownCommit
    },

    // React to one engine `json-change` ({ op, source, prevDoc, doc }).
    onJsonChange(payload: { op?: unknown; source?: string } | undefined): void {
      const engine = deps.getEngine()
      const id = deps.getCurrentId()
      if (!engine || !id) return

      // Stash the real engine history for in-session tab-switch restoration —
      // unchanged from the pre-lazy pipeline (cheap object read + map).
      deps.stashEngineHistory(id, engine.getHistory())

      // Identity op (queued ops composed away, e.g. IME): content unchanged.
      if (payload?.op == null) return

      if (payload.source === 'history') {
        // Undo/redo: uncertain state — resolve clean/dirty NOW (G6).
        commitPendingMarkdown()
        return
      }

      if (payload.source === 'api') {
        // Baseline swap (setContent / replaceContent): re-sync the serialized
        // snapshot and the synthetic content id WITHOUT flagging an edit — the
        // store's hash comparison then decides cleanliness by itself (a reload
        // back to the saved content stays clean, source-mode edits read dirty
        // against the saved id). The pre-lazy pipeline processed these events
        // uniformly; keeping that invariant is what allows an undo to land
        // back on content that was only ever installed programmatically.
        commitPendingMarkdown()
        return
      }

      if (payload.source !== 'user') return

      // Deterministic user edit: the content changed vs the pre-edit state, so
      // dirty is known without hashing. If this edit is later reverted
      // character-for-character (or an undo lands on saved content), the
      // debounced full commit recomputes the hash and restores cleanliness
      // within one debounce window — never wrongly-clean, at most briefly
      // wrongly-dirty.
      pendingMarkdownCommit = true
      deps.dispatch({
        id,
        markdown: null,
        edit: true,
        wordCount: null,
        cursor: deps.serializeCursor(engine.getSelection()),
        history: null,
        toc: null,
        blocks: null
      })

      pendingDerived = { id }
      if (derivedTimer !== null) clearTimeout(derivedTimer)
      derivedTimer = setTimeout(flushDerivedState, deps.derivedDebounceMs ?? 120)
    },

    // Flush-on-read: apply pending engine ops, then serialize once if a
    // keystroke is still uncommitted. Safe to call repeatedly.
    flushActive(): void {
      const engine = deps.getEngine()
      if (!engine) return
      engine.flush()
      if (pendingMarkdownCommit) commitPendingMarkdown()
    },

    // The engine's document is being swapped out (setContent / replaceContent
    // / reload): any uncommitted keystrokes belong to the outgoing document
    // and are dropped — callers must have flushed beforehand if they are
    // needed. Clears the flag so a stale commit can never fire afterwards.
    markBaseline(): void {
      pendingMarkdownCommit = false
      if (derivedTimer !== null) {
        clearTimeout(derivedTimer)
        derivedTimer = null
      }
      pendingDerived = null
    },

    // Cancel a scheduled pause flush without touching the commit flag
    // (component teardown).
    dispose(): void {
      if (derivedTimer !== null) {
        clearTimeout(derivedTimer)
        derivedTimer = null
      }
      pendingDerived = null
    }
  }
}
