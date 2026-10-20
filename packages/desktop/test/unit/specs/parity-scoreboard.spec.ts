import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { PARITY_OPEN_BASELINE, parityEntries } from '../utils/parityLedger'

// The parity scoreboard (test/PARITY_SCOREBOARD.md) is a human board; this
// spec is its machine shadow. It parses the board's table and requires an
// exact match with parityLedger.ts — ids, severity, status and coverage
// locations — so the board cannot claim a state the tree does not have:
//
//   - a row flipped to ✅ while its tests are still xfail (or vice versa)
//     fails the status reconciliation
//   - a gap whose coverage file was renamed or deleted fails the location
//     check
//   - every `PGn:` test title must belong to a registered gap
//   - the number of `test.fail()` / `it.fails()` markers must equal the
//     number of open gaps — the accept-defer mechanism cannot silently
//     outlive the gaps it was created for
//   - the open count is ratcheted at PARITY_OPEN_BASELINE
//
// Seeding the registry (2026-10-20) immediately caught the board's stale
// PG14 row — marked accept-defer xfail while the fix had landed via
// `replaceContent` and the tests were live. See the ledger header.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')

const SCOREBOARD_REL = 'test/PARITY_SCOREBOARD.md'
const QA_REL = 'test/PARITY_QA.md'
/** The QA checklist as referenced from the board's location column (repo-root
 *  relative, like every other path in that column). */
const QA_REPO_REL = 'packages/desktop/test/PARITY_QA.md'

const readPkgFile = (rel: string): string => readFileSync(resolve(PKG_ROOT, rel), 'utf-8')

// --- board parsing ---------------------------------------------------------

interface BoardRow {
  id: string
  severity: string
  /** Backticked, path-like tokens from the Test location(s) cell. */
  locations: string[]
  status: 'fixed' | 'open'
}

const boardRows: BoardRow[] = []
for (const line of readPkgFile(SCOREBOARD_REL).split('\n')) {
  const head = /^\|\s*\*\*(PG\d+)\*\*\s*\|/.exec(line)
  if (!head) continue
  const cells = line.split('|').map((cell) => cell.trim())
  const statusCell = cells[6] ?? ''
  const status = statusCell.startsWith('✅') ? 'fixed' : statusCell.startsWith('❌') ? 'open' : null
  if (status === null) throw new Error(`unparseable status cell for ${head[1]}: "${statusCell}"`)
  boardRows.push({
    id: head[1],
    severity: cells[2],
    locations: [...(cells[4] ?? '').matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .filter((token) => token.includes('/') && /\.(ts|md)$/.test(token))
      .sort(),
    status
  })
}

const gapsRemaining = /Gaps remaining:\s*(\d+)\s*\/\s*15/.exec(readPkgFile(SCOREBOARD_REL))

// --- tree parsing ----------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'lib'])
const SPEC_FILE = /\.(spec|test)\.(ts|js)$/

const walk = (absDir: string, relDir: string, out: string[]): void => {
  for (const name of readdirSync(absDir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(absDir, name)
    const rel = relDir ? `${relDir}/${name}` : name
    if (statSync(abs).isDirectory()) walk(abs, rel, out)
    else if (SPEC_FILE.test(name)) out.push(rel)
  }
}

const REPO_ROOT = resolve(PKG_ROOT, '../..')
const specFiles: string[] = []
walk(REPO_ROOT, '', specFiles)

/** PG ids used in test/describe titles across the repo. */
const titledGapIds = new Set<string>()
/** Files carrying a `test.fail()` / `it.fails()` expected-failure marker. */
const xfailFiles = new Set<string>()
for (const file of specFiles) {
  const lines = readFileSync(resolve(REPO_ROOT, file), 'utf-8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
  for (const line of lines) {
    const title = /^\s*(?:test|it|describe)(?:\.\w+)?\s*\(\s*'([^']*)'/.exec(line)
    if (title) for (const m of title[1].matchAll(/\bPG(\d+)\b/g)) titledGapIds.add(`PG${m[1]}`)
    if (/^\s*(?:test|it)\.(?:fail|fails)\s*\(/.test(line)) xfailFiles.add(file)
  }
}

const openEntries = parityEntries.filter((entry) => entry.status === 'open')

describe('parity scoreboard', () => {
  it('matches the registry row for row', () => {
    const board = new Map(boardRows.map((row) => [row.id, row]))
    const registry = new Map(parityEntries.map((entry) => [entry.id, entry]))

    const boardOnly = [...board.keys()].filter((id) => !registry.has(id))
    const registryOnly = [...registry.keys()].filter((id) => !board.has(id))

    expect(boardOnly, 'board rows with no registry entry — add it to parityLedger.ts').toEqual([])
    expect(
      registryOnly,
      'registry entries missing from the board — add the row to PARITY_SCOREBOARD.md'
    ).toEqual([])

    const mismatched: string[] = []
    for (const entry of parityEntries) {
      const row = board.get(entry.id)
      if (!row) continue
      if (row.severity !== entry.severity) {
        mismatched.push(
          `${entry.id}: severity ${row.severity} (board) vs ${entry.severity} (registry)`
        )
      }
      if (row.status !== entry.status) {
        mismatched.push(`${entry.id}: status ${row.status} (board) vs ${entry.status} (registry)`)
      }
      const expected = [...entry.tests, ...(entry.qa ? [QA_REPO_REL] : [])].sort()
      if (JSON.stringify(row.locations) !== JSON.stringify(expected)) {
        mismatched.push(
          `${entry.id}: locations ${JSON.stringify(row.locations)} (board) vs ${JSON.stringify(expected)} (registry)`
        )
      }
    }
    expect(mismatched, 'board rows that disagree with the registry').toEqual([])
  })

  it('points every registered gap at coverage that exists', () => {
    const missing: string[] = []
    for (const entry of parityEntries) {
      for (const test of entry.tests) {
        if (!existsSync(resolve(REPO_ROOT, test))) missing.push(`${entry.id}: ${test} is gone`)
      }
      if (entry.qa && !new RegExp(`^## ${entry.qa}\\b`, 'm').test(readPkgFile(QA_REL))) {
        missing.push(`${entry.id}: PARITY_QA.md has no "## ${entry.qa}" section`)
      }
    }
    expect(missing, 'registered coverage that no longer exists').toEqual([])
  })

  it('knows every gap id used in a test title', () => {
    const known = new Set(parityEntries.map((entry) => entry.id))
    const unknown = [...titledGapIds].filter((id) => !known.has(id)).sort()
    expect(
      unknown,
      'test titles referencing gap ids the registry does not know — register the gap or fix the title'
    ).toEqual([])
  })

  it('keeps expected-failure markers in lockstep with open gaps', () => {
    // The accept-defer mechanism (test.fail / it.fails) exists to park a gap
    // while keeping suites green; a marker without an open gap — or an open
    // gap without a marker — means the board and the tree disagree.
    expect(
      xfailFiles.size,
      'expected-failure markers exist but no gap is registered open — flip the gap fixed and delete the markers'
    ).toBe(openEntries.length)
    for (const entry of openEntries) {
      expect(
        entry.tests.some((test) => xfailFiles.has(test)),
        `${entry.id} is open but none of its coverage files carries an expected-failure marker`
      ).toBe(true)
    }
  })

  it('states the same remaining count as the registry', () => {
    expect(
      gapsRemaining,
      'PARITY_SCOREBOARD.md lost its "Gaps remaining: N / 15" line'
    ).not.toBeNull()
    expect(
      Number(gapsRemaining?.[1]),
      'the board\'s "Gaps remaining" count disagrees with the registry'
    ).toBe(openEntries.length)
  })

  it('keeps the open-gap count at or below its baseline', () => {
    // Seeded 2026-10-20 at 0 (the registry caught the stale PG14 row — the
    // fix had landed via replaceContent and the markers were already gone).
    // A newly discovered gap must be fixed before merge, not parked as an
    // accepted failure; this ratchet is what makes that binding.
    expect(
      openEntries.length,
      'open gaps grew past the baseline — a new gap must be fixed before merge, not registered as an accepted failure'
    ).toBeLessThanOrEqual(PARITY_OPEN_BASELINE)
  })
})
