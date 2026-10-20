import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { SKIP_BASELINE, conditionalExemptions, unconditionalSkips } from '../utils/skipLedger'

// Skipped tests are registered debt or registered gates — never silent.
// This spec walks every spec file in the repo, classifies each
// skip/fixme call site, and requires an exact match with the ledger:
//
//   - unconditional (`test.skip('title')` / `test.fixme('title')`): must be
//     ledgered by file + exact title; the count may only shrink
//   - conditional (`test.skip(cond, …)` / `it.skipIf(cond)`): must match a
//     registered exemption (file + condition substring); the exemption
//     carries the reason and must stay in use
//   - `test.only` / `it.only` / `describe.only` / `xit` / `fit` /
//     `.fails`: forbidden outright — focused and expected-failure tests
//     misreport the suite's state
//
// Sites are matched line-anchored: a skip call always starts a line in this
// repo, which also keeps prose that merely mentions `test.skip(…)` out of
// the extraction.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const REPO_ROOT = resolve(PKG_ROOT, '../..')

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

const specFiles: string[] = []
walk(REPO_ROOT, '', specFiles)

interface Site {
  file: string
  line: number
  /** Full call text from the opening paren to the end of the line. */
  call: string
}

const FORBIDDEN = [
  /^\s*(?:test|it|describe)\.only\s*\(/,
  /^\s*(?:test|it|describe)\.fails\s*\(/,
  /^\s*(?:xit|xdescribe|fit|fdescribe)\s*\(/
]
const SKIP_CALL = /^\s*(?:test|it|describe)\.(skip|fixme)\s*\((.*)$/
const SKIP_IF_CALL = /^\s*(?:test|it|describe)\.skipIf\s*\((.*)$/

const forbidden: Site[] = []
const unconditional: { site: Site; kind: 'skip' | 'fixme'; title: string }[] = []
const conditional: Site[] = []

// Line endings are normalized first: several spec files are CRLF, and a
// trailing \r is a JS line terminator — `.` does not match it, so an
// unnormalized `(.*)$` silently fails to match the call.
const readLines = (file: string): string[] =>
  readFileSync(resolve(REPO_ROOT, file), 'utf-8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))

for (const file of specFiles) {
  const lines = readLines(file)
  lines.forEach((text, i) => {
    if (FORBIDDEN.some((re) => re.test(text))) {
      forbidden.push({ file, line: i + 1, call: text.trim() })
      return
    }
    const skip = SKIP_CALL.exec(text)
    if (skip) {
      const site: Site = { file, line: i + 1, call: skip[2] }
      const literal = /^(['"`])((?:(?!\1).)*)\1/.exec(skip[2])
      if (literal) {
        unconditional.push({ site, kind: skip[1] as 'skip' | 'fixme', title: literal[2] })
      } else conditional.push(site)
      return
    }
    const skipIf = SKIP_IF_CALL.exec(text)
    if (skipIf) conditional.push({ file, line: i + 1, call: skipIf[1] })
  })
}

const siteLabel = (site: Site): string => `${site.file}:${site.line} ${site.call}`

describe('skip/fixme ledger', () => {
  it('has no focused or expected-failure tests', () => {
    expect(
      forbidden.map(siteLabel),
      'focused (.only/xit/fit) or expected-failure (.fails) tests misreport the suite — remove them'
    ).toEqual([])
  })

  it('registers every unconditional skip/fixme, with no stale entries', () => {
    const key = (file: string, title: string): string => `${file}\u0000${title}`
    const ledger = new Map(unconditionalSkips.map((s) => [key(s.file, s.title), s]))
    const seen = new Map(unconditional.map(({ site, title }) => [key(site.file, title), site]))

    const unledgered = [...seen].filter(([k]) => !ledger.has(k)).map(([, site]) => siteLabel(site))
    const stale = [...ledger].filter(([k]) => !seen.has(k)).map(([k]) => k.replace('\u0000', ' — '))

    expect(
      unledgered,
      'unconditional skip/fixme sites the ledger does not know — add an entry with a reason, or unskip the test'
    ).toEqual([])
    expect(
      stale,
      'ledger entries whose skip is gone — delete the entry and lower the baseline'
    ).toEqual([])
    for (const entry of unconditionalSkips) {
      const site = seen.get(key(entry.file, entry.title))
      expect(site, `${entry.file} "${entry.title}" should still be skipped`).toBeDefined()
    }
  })

  it('keeps the unconditional count at or below its baseline', () => {
    // Seeded 2026-10-20 at the tree's current four (two fixme + two skip).
    // Unskipping one means deleting its entry and lowering this number in
    // the same change — never raising it.
    expect(
      unconditional.length,
      'unconditional skips grew past the baseline — a new one must be justified in the ledger AND the baseline raised in the same change, which is exactly what this ratchet forbids'
    ).toBeLessThanOrEqual(SKIP_BASELINE)
    expect(unconditional.length, 'ledger total drifted from the tree').toBe(
      unconditionalSkips.length
    )
  })

  it('matches every conditional gate to a registered exemption', () => {
    const unmatched = conditional.filter(
      (site) =>
        !conditionalExemptions.some(
          (exemption) =>
            exemption.files.includes(site.file) && site.call.includes(exemption.condition)
        )
    )
    expect(
      unmatched.map(siteLabel),
      'conditional skips whose (file, condition) is not a registered exemption — register the gate with a reason, or remove it'
    ).toEqual([])
  })

  it('keeps every exemption in use', () => {
    const stale = conditionalExemptions.filter(
      (exemption) =>
        !conditional.some(
          (site) => exemption.files.includes(site.file) && site.call.includes(exemption.condition)
        )
    )
    expect(
      stale.map((exemption) => `${exemption.files.join(', ')} (${exemption.condition})`),
      'exemptions with no matching gate left — the debt they covered is gone, drop them'
    ).toEqual([])
  })
})
