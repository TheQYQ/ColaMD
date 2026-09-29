// Search probe worker: compiles the user's regex and scans the document text
// with a between-matches deadline. The main thread holds a watchdog and
// terminates this worker on a true hang (a single exec that never returns —
// e.g. catastrophic backtracking — cannot check any deadline from inside).

import { PROBE_BUDGET_MS, scanWithBudget, type ProbeReply } from './regexProbeShared'

interface ProbeRequest {
  id: number
  pattern: string
  flags: string
  text: string
}

const post = (msg: ProbeReply): void => {
  ;(self as unknown as { postMessage: (m: ProbeReply) => void }).postMessage(msg)
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
  const result = scanWithBudget(reg, text, Date.now() + PROBE_BUDGET_MS)
  post({ id, status: 'ok', matchCount: result.matchCount, timedOut: result.timedOut })
}
