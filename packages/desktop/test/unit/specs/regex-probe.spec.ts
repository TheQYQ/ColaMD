import { describe, expect, it } from 'vitest'
import { probeResultFromReply, scanWithBudget } from '@/components/search/regexProbeShared'

describe('scanWithBudget — the search probe scanner', () => {
  it('counts matches for a benign pattern', () => {
    const { matchCount, timedOut } = scanWithBudget(/(ab)+/g, 'ababab ab', Date.now() + 1000)
    expect(timedOut).toBe(false)
    expect(matchCount).toBe(2)
  })

  it('times out immediately when the deadline has already passed', () => {
    const { matchCount, timedOut } = scanWithBudget(/a/g, 'aaaa', Date.now() - 1)
    expect(timedOut).toBe(true)
    expect(matchCount).toBe(0)
  })

  it('times out between matches on a tight budget', () => {
    // Each iteration checks the deadline before the next exec, so a budget
    // that expires mid-scan stops with a partial count rather than hanging.
    const { timedOut } = scanWithBudget(/a/g, 'a'.repeat(100000), Date.now())
    expect(timedOut).toBe(true)
  })

  it('resets lastIndex so a reused RegExp object starts from the beginning', () => {
    const reg = /a/g
    reg.exec('ba')
    const { matchCount } = scanWithBudget(reg, 'aa', Date.now() + 1000)
    expect(matchCount).toBe(2)
  })
})

describe('probeResultFromReply — the budget decision', () => {
  it('refuses a scan that ran out of budget instead of reporting it as ok', () => {
    // The real search would cost at least this much on the main thread, so a
    // partial count is a refusal, not a pass. Reporting `ok` here was the hole.
    expect(probeResultFromReply({ id: 1, status: 'ok', matchCount: 9, timedOut: true })).toEqual({
      status: 'timeout'
    })
  })

  it('passes a scan that finished inside the budget', () => {
    expect(probeResultFromReply({ id: 1, status: 'ok', matchCount: 2, timedOut: false })).toEqual({
      status: 'ok',
      matchCount: 2
    })
  })

  it('keeps an uncompilable pattern distinguishable from a timeout', () => {
    expect(probeResultFromReply({ id: 1, status: 'invalid' })).toEqual({ status: 'invalid' })
  })
})
