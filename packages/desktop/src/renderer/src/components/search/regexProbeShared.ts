// Pure scanning loop shared by the search probe worker and its unit tests.
// The deadline can only be checked BETWEEN exec calls — a single pathological
// exec hangs until the main thread terminates the worker (see
// searchRegexProbe.ts), so this function is the graceful-degradation layer for
// slow-but-finite scans, not the hard guarantee.

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
