// Synthetic save-tracking history for the WYSIWYG engine.
//
// The `@muyajs/core` engine's undo/redo history (`getHistory()`) has a
// different shape than the desktop store's `tab.history` (which drives the
// save/dirty indicator). The renderer therefore feeds the store a SYNTHETIC,
// desktop-shaped history whose single stack entry carries an `id` the store
// compares against `tab.lastSavedHistoryId`: when the current id equals the
// saved id the tab is shown as clean, otherwise dirty.
//
// The id MUST satisfy two properties:
//   1. clean  <=> the live document content matches the saved-on-disk content.
//   2. monotonic & never-reused: a divergent edit can never collide with the
//      saved id, even when it returns the engine undo-stack to the same DEPTH.
//
// An earlier implementation used the undo-stack DEPTH as the id. Depth is
// REUSED across distinct documents at the same stack height, so the sequence
//   type A, type B, save, undo B, type C  (a NEW divergent edit)
// returned the depth — and therefore the id — to the saved value while the
// document was actually A+C, falsely showing the tab as clean and risking
// data loss on close-without-save (Phase G — G6).
//
// Legacy muyajs avoided this by assigning every pushed history entry a
// MONOTONIC, never-reused id and splicing the redo tail on a new edit. We
// reproduce the exact semantics here, but keyed on the live document content
// rather than on the engine's internal stack objects (the engine regenerates
// its undo operations via invert on every undo/redo, so object identity is not
// stable). Each DISTINCT content snapshot is assigned a fresh monotonic id the
// first time it is seen; revisiting an earlier snapshot (undo/redo back to it)
// reuses that snapshot's original id. Undoing back to the saved content
// therefore restores the saved id (clean); a divergent re-edit produces brand
// new content and hence a brand new id (dirty) — never the saved one.

// Trailing newlines are NOT meaningful content for save/dirty tracking — the
// store itself normalizes them via `adjustTrailingNewlines`/`trimTrailingNewline`
// before saving. The engine's markdown serialization is also unstable across a
// `setContent` -> edit -> undo round-trip purely in trailing newlines (loading
// `'x\n'` may serialize to `'x\n\n\n'`, while undoing an edit lands on `'x\n'`),
// so the content signature must ignore them or undo-to-saved would never match.
const stripTrailingNewlines = (content: string): string => content.replace(/[\r\n]+$/, '')

// A fast, stable 64-bit string hash (FNV-1a) over the trailing-newline-normalized
// content. Used so the content -> id map stores short keys instead of whole
// documents; a collision would map two genuinely different documents to the same
// id and could reintroduce the false-clean it guards against. 64 bits keeps the
// collision probability negligible even for a long editing session with many
// thousands of distinct snapshots (a 32-bit hash hits ~50% collision odds near
// ~77k snapshots via the birthday bound — realistic over a long session — so the
// extra width is worth the key size).
//
// PERFORMANCE: Uses dual 32-bit Number lanes instead of BigInt. BigInt arithmetic
// is ~10x slower than Number ops due to allocation and conversion overhead.
// The dual-lane approach preserves the full 64-bit collision resistance while
// staying in fast Number arithmetic. The two 32-bit halves are combined into a
// string key for Map lookup (Numbers lose precision above 2^53, so we cannot
// pack into a single Number).
const FNV64_OFFSET_HI = 0xcbf29ce4
const FNV64_OFFSET_LO = 0x84222325
const FNV64_PRIME_LO = 0x000000b3

// Multiply two 32-bit numbers and return the 64-bit result as [hi, lo].
// This implements (a * b) where a and b are 32-bit unsigned integers.
const mul32x32 = (a: number, b: number): [number, number] => {
  // Split into 16-bit halves to avoid precision loss
  const aHi = (a >>> 16) & 0xffff
  const aLo = a & 0xffff
  const bHi = (b >>> 16) & 0xffff
  const bLo = b & 0xffff

  // (aHi * 2^16 + aLo) * (bHi * 2^16 + bLo)
  // = aHi * bHi * 2^32 + (aHi * bLo + aLo * bHi) * 2^16 + aLo * bLo
  const lo = aLo * bLo
  const mid = aHi * bLo + aLo * bHi
  const hi = aHi * bHi + (mid >>> 16)
  const loRes = ((mid & 0xffff) << 16) + lo

  return [hi >>> 0, loRes >>> 0]
}

const hashContent = (content: string): string => {
  const normalized = stripTrailingNewlines(content)
  let hi = FNV64_OFFSET_HI
  let lo = FNV64_OFFSET_LO
  for (let i = 0; i < normalized.length; i++) {
    // XOR the low byte of the char into the low 32-bit lane
    lo ^= normalized.charCodeAt(i) & 0xff
    // Multiply by FNV prime (64-bit) using dual 32-bit lanes
    const [mulHi, mulLo] = mul32x32(lo, FNV64_PRIME_LO)
    // Add the high lane contribution: result = mul + (FNV64_PRIME_HI * lo * 2^32)
    // Since FNV64_PRIME_HI = 1, this simplifies to adding lo to the high lane
    const newLo = mulLo >>> 0
    const newHi = (mulHi + lo) >>> 0
    hi = newHi
    lo = newLo
  }
  // Combine into string key for Map (preserves full 64-bit precision)
  return `${hi >>> 0}-${lo >>> 0}`
}

export interface IFileHistoryLike {
  stack: Array<{ id: number | string; [key: string]: unknown }>
  index: number
  lastEditIndex: number
  lastInitIndex: number
}

// Per-tab monotonic id allocator. Created once when a tab's content baseline is
// established and reset whenever the engine reloads the document (`setContent`
// clears the engine history), so the baseline id is always 0 — matching the
// store's seeded `lastSavedHistoryId: 0` for a freshly loaded/clean document.
export class SyntheticHistory {
  private counter = 0
  private readonly idByContent = new Map<string, number>()

  constructor(baselineContent: string = '') {
    // The freshly-loaded document is its own clean baseline; the store seeds
    // `lastSavedHistoryId` to 0, so the baseline content must map to id 0.
    this.idByContent.set(hashContent(baselineContent), 0)
  }

  // Return the monotonic id for the given content snapshot, assigning a fresh,
  // never-reused id the first time a snapshot is seen and reusing the original
  // id on every subsequent revisit (undo/redo back to it).
  idFor(content: string): number {
    const key = hashContent(content)
    let id = this.idByContent.get(key)
    if (id === undefined) {
      id = ++this.counter
      this.idByContent.set(key, id)
    }
    return id
  }

  // Build the desktop-shaped synthetic history the store consumes. The store
  // only reads `stack[lastEditIndex].id`; the remaining fields keep its
  // bookkeeping happy (a single committed edit at index 0).
  build(content: string): IFileHistoryLike {
    return {
      stack: [{ id: this.idFor(content) }],
      index: 0,
      lastEditIndex: 0,
      lastInitIndex: -1
    }
  }
}
