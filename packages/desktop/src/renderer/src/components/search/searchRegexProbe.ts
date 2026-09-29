// Main-thread API for the search regex probe (ReDoS guard).
//
// The user's regex is executed against the document by muya's search module
// (WYSIWYG, per content block) and CodeMirror's search cursor (source mode) —
// both synchronous on the renderer main thread. A pathological pattern
// therefore freezes the window with no recovery path. This probe runs the same
// pattern against the same document text inside a worker first: a scan that
// exceeds its budget, or a single exec that never returns (recovered by
// terminating the worker from here), refuses the search with an error message
// instead of freezing the editor.
import {
  PROBE_BUDGET_MS,
  probeResultFromReply,
  type ProbeReply,
  type SearchProbeResult
} from './regexProbeShared'

const WATCHDOG_MS = PROBE_BUDGET_MS + 1500

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (result: SearchProbeResult) => void>()
let watchdog: ReturnType<typeof setTimeout> | null = null
let warnedUnavailable = false

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
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn('[search] regex probe worker unavailable; searches run unguarded')
    }
    return null
  }
  worker.onmessage = (event: MessageEvent) => {
    const reply = event.data as ProbeReply
    const resolve = pending.get(reply.id)
    if (resolve) {
      pending.delete(reply.id)
      resolve(probeResultFromReply(reply))
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
 * the worker is unavailable or the text is empty (caller proceeds unguarded).
 *
 * Only one probe is in flight at a time: a new request supersedes whatever is
 * still running, because a query typed while the previous probe is hung would
 * otherwise queue behind an exec that never returns and be refused too.
 *
 * The regex construction mirrors muya's `matchString` (utils/search.ts) —
 * same flags and whole-word wrapping — so the probe costs at least what the
 * real search would.
 */
export async function probeSearchRegex(
  value: string,
  opt: SearchProbeOptions,
  text: string
): Promise<SearchProbeResult | null> {
  if (!text) return null
  killWorker()
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
  watchdog = setTimeout(() => killWorker(), WATCHDOG_MS)
  return promise
}
