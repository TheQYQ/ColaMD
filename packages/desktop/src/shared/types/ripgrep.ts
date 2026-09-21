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
