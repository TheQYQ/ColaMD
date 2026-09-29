// Pure scanning loop and reply mapping shared by the search probe worker, the
// main-thread API, and their unit tests. The deadline can only be checked
// BETWEEN exec calls — a single pathological exec hangs until the main thread
// terminates the worker (see searchRegexProbe.ts), so this function is the
// graceful-degradation layer for slow-but-finite scans.

export const PROBE_BUDGET_MS = 4000

export interface RegexScanResult {
  matchCount: number
  timedOut: boolean
}

export function scanWithBudget(reg: RegExp, text: string, deadlineMs: number): RegexScanResult {
  let matchCount = 0
  reg.lastIndex = 0
  for (;;) {
    if (Date.now() > deadlineMs) return { matchCount, timedOut: true }
    const m = reg.exec(text)
    if (!m) return { matchCount, timedOut: false }
    matchCount++
    // Zero-length match guard: force progress or exec loops forever.
    if (m.index === reg.lastIndex) reg.lastIndex++
  }
}

export type ProbeReply =
  | { id: number; status: 'invalid' }
  | { id: number; status: 'ok'; matchCount: number; timedOut: boolean }

export type SearchProbeResult =
  | { status: 'ok'; matchCount: number }
  | { status: 'timeout' }
  | { status: 'invalid' }

// A scan that ran out of budget did not finish, so the real synchronous search
// over the same text would stall the main thread for at least as long: refuse
// it. Reporting `ok` here is what made the budget layer decorative.
export function probeResultFromReply(reply: ProbeReply): SearchProbeResult {
  if (reply.status === 'invalid') return { status: 'invalid' }
  return reply.timedOut ? { status: 'timeout' } : { status: 'ok', matchCount: reply.matchCount }
}
