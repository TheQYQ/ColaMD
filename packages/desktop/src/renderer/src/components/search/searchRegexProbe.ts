// Main-thread API for the search regex probe (ReDoS guard).
//
// The user's regex is executed against the whole document by muya's search
// module (WYSIWYG) and CodeMirror's search cursor (source mode) — both
// synchronous on the renderer main thread. A pathological pattern therefore
// freezes the window with no recovery path. This probe runs the SAME pattern
// against the SAME document text inside a worker first: a hang is recovered by
// terminating the worker from here, and the search is refused with an error
// message instead of freezing the editor.

export type SearchProbeResult =
  | { status: 'ok'; matchCount: number }
  | { status: 'timeout' }
  | { status: 'invalid' }

const PROBE_BUDGET_MS = 4000
const WATCHDOG_MS = PROBE_BUDGET_MS + 1500

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (result: SearchProbeResult) => void>()
let watchdog: ReturnType<typeof setTimeout> | null = null

function killWorker(): void {
  worker?.terminate()
  worker = null
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = null
  }
  // Whatever was in flight dies with the worker — report it as a timeout so
  // the search is refused rather than silently dropped.
  for (const resolve of pending.values()) resolve({ status: 'timeout' })
  pending.clear()
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./searchProbe.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    // Worker unavailable: the caller degrades to the old synchronous path.
    return null
  }
  worker.onmessage = (event: MessageEvent) => {
    const { id, status, matchCount } = event.data as {
      id: number
      status: string
      matchCount?: number
    }
    const resolve = pending.get(id)
    if (resolve) {
      pending.delete(id)
      if (status === 'invalid') resolve({ status: 'invalid' })
      else resolve({ status: 'ok', matchCount: matchCount ?? 0 })
    }
    if (pending.size === 0 && watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }
  // A worker-level error kills the instance; in-flight probes resolve as
  // timeouts so the UI refuses the search instead of hanging.
  worker.onerror = () => killWorker()
  return worker
}

export interface SearchProbeOptions {
  isCaseSensitive: boolean
  isWholeWord: boolean
  isRegexp: boolean
}

/**
 * Pre-flight a search regex against the document text. Returns `null` when
 * the worker is unavailable (caller degrades to the synchronous path).
 *
 * The regex construction mirrors muya's `matchString` (utils/search.ts) —
 * same flags and whole-word wrapping — so a pattern that passes this probe
 * cannot hang the real search over the same text.
 */
export async function probeSearchRegex(
  value: string,
  opt: SearchProbeOptions,
  text: string
): Promise<SearchProbeResult | null> {
  if (!text) return null
  const w = ensureWorker()
  if (!w) return null

  // Mirror muya's matchString (utils/search.ts) exactly: same flag rules,
  // special-char escaping for plain-text mode, and whole-word wrapping.
  let flags = 'g'
  if (!opt.isCaseSensitive) flags += 'i'
  let regStr = value
  if (!opt.isRegexp) {
    regStr = value.replace(/[[\]\\^$.|?*+()/]/g, (p) => (p === '\\' ? '\\\\' : `\\${p}`))
  }
  if (opt.isWholeWord) regStr = `\\b${regStr}\\b`

  const id = nextId++
  const promise = new Promise<SearchProbeResult>((resolve) => {
    pending.set(id, resolve)
  })
  w.postMessage({ id, pattern: regStr, flags, text })
  if (!watchdog) {
    watchdog = setTimeout(() => killWorker(), WATCHDOG_MS)
  }
  return promise
}
