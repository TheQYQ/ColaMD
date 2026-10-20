// The `mt::rg::start` payload, owned by the contract rather than by either end.
//
// Both sides used to keep their own copy of this shape: main declared
// `RipgrepRequest`/`SearchOptions` locally and cast the incoming `unknown`, while
// the renderer built the object by stripping its own callbacks and JSON-cloning
// the rest. Nothing checked that the two agreed, which is why the channel could
// not go through `typedHandle`.
//
// `options` is the search UI's settings minus the two callbacks it also carries
// (`didMatch` / `didSearchPaths`), which the renderer removes before sending —
// functions are not structured-cloneable, and main never reads them.

export interface RipgrepSearchOptions {
  isRegexp?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  followSymlinks?: boolean
  maxFileSize?: number | string
  includeHidden?: boolean
  noIgnore?: boolean
  leadingContextLineCount?: number
  trailingContextLineCount?: number
  inclusions?: string[]
  exclusions?: string[]
}

export interface RipgrepRequest {
  searchId: string
  mode: 'files' | 'text'
  directories: string[]
  pattern: string
  options: RipgrepSearchOptions
}

// ---------------------------------------------------------------------
// Push-event payloads (main → renderer)
//
// The five `mt::rg::*` events below used to be declared `unknown` in
// `shared/types/ipc.ts`, so neither the emitters in `src/main/ipc/ripgrep.ts`
// nor the preload bridge was checked against the actual shapes. The envelopes
// are now owned here, like `RipgrepRequest` above.

/**
 * One match inside a file, as emitted by `mt::rg::match` in text mode.
 * `leadingContextLines` / `trailingContextLines` are plain text lines; the
 * current main-side parser always emits them empty (rg `--context` output is
 * not wired up yet), and `string[]` keeps that honest — populating them with
 * anything else now fails at the emit site.
 */
export interface RipgrepMatch {
  matchText: string
  lineText: string
  range: [[number, number], [number, number]]
  leadingContextLines: string[]
  trailingContextLines: string[]
}

/**
 * `mt::rg::match` envelope. Text mode carries per-file match groups; files
 * mode carries one raw ripgrep output line (a file path) per event — the
 * renderer tells the two apart by the mode it asked for.
 */
export interface RipgrepMatchEvent {
  searchId: string
  payload: string | { filePath: string; matches: RipgrepMatch[] }
}

export interface RipgrepProgressEvent {
  searchId: string
  num: number
}

export interface RipgrepDoneEvent {
  searchId: string
}

export interface RipgrepCancelledEvent {
  searchId: string
}

export interface RipgrepErrorEvent {
  searchId: string
  error: string
}
