// Thin renderer wrapper over the main-process ripgrep IPC bridge.
// Returns a cancellable thenable with the same public shape as the legacy
// in-renderer searcher (so call sites in quickOpen don't need to change).

import { deepClone } from '../util'
import type {
  RipgrepSearchOptions as ContractRipgrepSearchOptions,
  RipgrepMatchEvent,
  RipgrepProgressEvent,
  RipgrepDoneEvent,
  RipgrepErrorEvent,
  RipgrepCancelledEvent
} from '@shared/types/ripgrep'

type RipgrepMode = 'text' | 'files'

// The legacy searcher shape: the contract's search options plus the two
// callbacks the renderer strips before shipping across IPC (they are not
// structured-cloneable and main never reads them). The event envelopes the
// `mt::rg::*` listeners receive are the contract's own types now.
interface RipgrepSearchOptions extends ContractRipgrepSearchOptions {
  didMatch?: (payload: unknown) => void
  didSearchPaths?: (num: unknown) => void
}

interface CancellableSearch extends Promise<void> {
  cancel: () => void
}

interface StartArgs {
  mode: RipgrepMode
  directories: unknown
  pattern: unknown
  options: RipgrepSearchOptions
}

let nextId = 1
const genId = (): string => `rg-${Date.now()}-${nextId++}`

const startSearch = ({ mode, directories, pattern, options }: StartArgs): CancellableSearch => {
  const searchId = genId()
  const didMatch = options.didMatch || ((): void => {})
  const didSearchPaths = options.didSearchPaths || ((): void => {})

  let offMatch: (() => void) | null = null
  let offProgress: (() => void) | null = null
  let offDone: (() => void) | null = null
  let offError: (() => void) | null = null
  let offCancelled: (() => void) | null = null
  let cancelled = false

  const cleanup = (): void => {
    if (offMatch) offMatch()
    if (offProgress) offProgress()
    if (offDone) offDone()
    if (offError) offError()
    if (offCancelled) offCancelled()
    offMatch = offProgress = offDone = offError = offCancelled = null
  }

  const promise = new Promise<void>((resolve, reject) => {
    // The contract types the envelopes, so the searchId filter is the only
    // runtime check left: concurrent searches share the five channels.
    offMatch = window.ripgrep.onMatch((env: RipgrepMatchEvent) => {
      if (env.searchId !== searchId) return
      try {
        didMatch(env.payload)
      } catch (err) {
        console.error(err)
      }
    })
    offProgress = window.ripgrep.onProgress((env: RipgrepProgressEvent) => {
      if (env.searchId !== searchId) return
      try {
        didSearchPaths(env.num)
      } catch (err) {
        console.error(err)
      }
    })
    offDone = window.ripgrep.onDone((env: RipgrepDoneEvent) => {
      if (env.searchId !== searchId) return
      cleanup()
      resolve()
    })
    offError = window.ripgrep.onError((env: RipgrepErrorEvent) => {
      if (env.searchId !== searchId) return
      cleanup()
      reject(new Error(env.error || 'Ripgrep search failed'))
    })
    offCancelled = window.ripgrep.onCancelled((env: RipgrepCancelledEvent) => {
      if (env.searchId !== searchId) return
      cleanup()
      resolve()
    })

    // Strip non-serializable callbacks before shipping options across IPC.
    // Pinia/Vue can hand us reactive Proxies that fail structured clone, so
    // do a JSON round-trip on the remaining options to get plain values.

    const { didMatch: _a, didSearchPaths: _b, ...rest } = options
    let serializable: ContractRipgrepSearchOptions
    try {
      serializable = deepClone(rest)
    } catch {
      serializable = rest
    }
    const plainDirectories = Array.isArray(directories) ? directories.map((d) => String(d)) : []
    window.ripgrep
      .start({
        searchId,
        mode,
        directories: plainDirectories,
        pattern: typeof pattern === 'string' ? pattern : String(pattern || ''),
        options: serializable
      })
      .catch((err) => {
        cleanup()
        reject(err)
      })
  }) as CancellableSearch

  promise.cancel = (): void => {
    if (cancelled) return
    cancelled = true
    window.ripgrep.cancel(searchId)
  }
  return promise
}

export class FileSearcher {
  search(
    directories: string[],
    _pattern: string,
    options: RipgrepSearchOptions
  ): CancellableSearch {
    return startSearch({ mode: 'files', directories, pattern: '', options })
  }
}
