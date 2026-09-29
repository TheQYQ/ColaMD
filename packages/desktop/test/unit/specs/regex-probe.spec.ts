import { describe, expect, it } from 'vitest'
import { scanWithBudget } from '@/components/search/regexProbeShared'

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
