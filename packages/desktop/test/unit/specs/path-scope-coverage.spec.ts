import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import {
  accidentalReachability,
  assertSites,
  channelClasses,
  grantSiteFiles,
  grantSites,
  type LedgerSite
} from '../utils/pathScopeInventory'
import { scanSource } from '../utils/pathScopeScanner'

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')

const scan = scanSource(PKG_ROOT)

const siteKeys = (sites: LedgerSite[]): string[] =>
  sites.map((s) => `${s.file}\t${s.snippet}`).sort()

describe('pathScope grant/assert coverage inventory', () => {
  it('classifies every registered channel, with no stale inventory entries', () => {
    const scanned = [...new Set(scan.registrations.map((r) => r.channel))].sort()
    const inventoried = Object.keys(channelClasses).sort()

    const missing = scanned.filter((c) => !(c in channelClasses))
    const stale = inventoried.filter((c) => !scanned.includes(c))

    expect(missing, 'channels scanned but not classified in pathScopeInventory').toEqual([])
    expect(stale, 'channels in inventory but not found by the scanner').toEqual([])
    expect(inventoried).toEqual(scanned)
  })

  it('assertPathInScope call sites match the ledger as an exact multiset', () => {
    expect(siteKeys(scan.assertSites)).toEqual(siteKeys(assertSites))
  })

  it('addAllowedRoot call sites match the ledger as an exact multiset', () => {
    expect(siteKeys(scan.grantSites)).toEqual(siteKeys(grantSites))
  })

  it('every scanned grant site lives in an allowlisted trusted-flow file', () => {
    const files = [...new Set(scan.grantSites.map((s) => s.file))].sort()
    const outside = files.filter((f) => !grantSiteFiles.includes(f))

    expect(
      outside,
      'addAllowedRoot call sites outside grantSiteFiles — new grant flows must be reviewed, not just listed'
    ).toEqual([])
  })

  it('accidental reachability equals IpcSendChannels ∩ onInternalChannel', () => {
    const send = new Set(scan.sendChannels)
    const internalNames = new Set(
      scan.registrations.filter((r) => r.via === 'onInternalChannel').map((r) => r.channel)
    )
    const scanned = [...internalNames].filter((c) => send.has(c)).sort()

    expect([...accidentalReachability].sort()).toEqual(scanned)
  })

  it('known-gap channels still exist in the scanned registrations', () => {
    const scanned = new Set(scan.registrations.map((r) => r.channel))
    const dangling = Object.entries(channelClasses)
      .filter(([channel, cls]) => cls.class === 'known-gap' && !scanned.has(channel))
      .map(([channel]) => channel)

    expect(dangling, 'known-gap ledger entries whose channel no longer exists').toEqual([])
  })

  it('known-gap ledger only shrinks (count ratchet)', () => {
    // Ratchet baseline: 9 seeded 2026-10 from the full-repo pathScope review.
    // Fixing a gap means gating it (class 'gated' + ledger entries) and then
    // lowering this number — never raising it.
    const KNOWN_GAP_BASELINE = 9
    const gaps = Object.values(channelClasses).filter((cls) => cls.class === 'known-gap')

    expect(
      gaps.length,
      'known gaps grew past the baseline — new holes must be fixed, not ledgered'
    ).toBeLessThanOrEqual(KNOWN_GAP_BASELINE)
  })
})
