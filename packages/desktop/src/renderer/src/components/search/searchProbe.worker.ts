// Search probe worker: compiles the user's regex and scans the document text
// with a between-matches deadline. The main thread holds a watchdog and
// terminates this worker on a true hang (a single exec that never returns —
// e.g. catastrophic backtracking — cannot check any deadline from inside).

import { scanWithBudget } from './regexProbeShared'

interface ProbeRequest {
  id: number
  pattern: string
  flags: string
  text: string
}

const post = (msg: unknown): void => {
  ;(self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg)
}

self.onmessage = (event: MessageEvent): void => {
  const { id, pattern, flags, text } = event.data as ProbeRequest
  let reg: RegExp
  try {
    reg = new RegExp(pattern, flags)
  } catch {
    post({ id, status: 'invalid' })
    return
  }
  const BUDGET_MS = 4000
  const result = scanWithBudget(reg, text, Date.now() + BUDGET_MS)
  post({ id, status: 'ok', matchCount: result.matchCount, timedOut: result.timedOut })
}
