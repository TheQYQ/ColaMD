import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { EXCLUDED, TODO_BASELINE, todoSites } from '../utils/todoLedger'

// TODO/FIXME/HACK debt is ratcheted, not a free-for-all. The ledger header
// documents the counting 口径 (markers, scope, vendored exclusions); this
// spec extracts the real sites from the two packages' src trees and requires
// an exact match with the ledger, so a new marker anywhere in scope fails by
// file+text, and the total may only shrink (remove a marker → delete its
// ledger entry → lower the baseline).
//
// Why file+text and not line numbers: every batch in this repo shifts lines,
// and a line-keyed ledger would go stale on unrelated edits. The marker text
// itself is the stable identity — editing a marker's wording is a conscious
// ledger update, which is the point.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const REPO_ROOT = resolve(PKG_ROOT, '../..')

const SRC_ROOTS = ['packages/desktop/src', 'packages/muya/src'] as const
const EXTS = ['.ts', '.vue', '.js', '.cjs', '.mjs']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'lib'])

const walk = (absDir: string, relDir: string, out: string[]): void => {
  for (const name of readdirSync(absDir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(absDir, name)
    const rel = relDir ? `${relDir}/${name}` : name
    if (statSync(abs).isDirectory()) walk(abs, rel, out)
    else if (EXTS.includes(name.slice(name.lastIndexOf('.')))) out.push(rel)
  }
}

const scopedFiles: string[] = []
for (const root of SRC_ROOTS) walk(resolve(REPO_ROOT, root), root, scopedFiles)
const excludedFiles = new Set(EXCLUDED.map((excluded) => excluded.file))
const countedFiles = scopedFiles.filter((file) => !excludedFiles.has(file))

const MARKER = /\b(TODO|FIXME|HACK)\b/g

/** Every marker site in scope: `file\u0000text` → occurrences. */
const extracted = new Map<string, number>()
for (const file of countedFiles) {
  for (const line of readFileSync(resolve(REPO_ROOT, file), 'utf-8').split('\n')) {
    MARKER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MARKER.exec(line)) !== null) {
      const key = `${file}\u0000${line.slice(match.index).trim()}`
      extracted.set(key, (extracted.get(key) ?? 0) + 1)
    }
  }
}

const ledger = new Map(todoSites.map((site) => [`${site.file}\u0000${site.text}`, site.count]))

const splitKey = (key: string): { file: string; text: string } => {
  const at = key.indexOf('\u0000')
  return { file: key.slice(0, at), text: key.slice(at + 1) }
}

describe('TODO/FIXME/HACK ledger', () => {
  it('registers every marker in scope, with no stale entries', () => {
    const unledgered = [...extracted].filter(([key, n]) => ledger.get(key) !== n)
    const stale = [...ledger].filter(([key]) => !extracted.has(key))

    expect(
      unledgered.map(([key, n]) => {
        const { file, text } = splitKey(key)
        return `${file}: "${text}" ×${n}, ledger says ×${ledger.get(key) ?? 0}`
      }),
      'markers in scope the ledger does not match — add an entry with a reason, or remove the marker'
    ).toEqual([])
    expect(
      stale.map(([key]) => {
        const { file, text } = splitKey(key)
        return `${file}: "${text}"`
      }),
      'ledger entries whose marker is gone — delete the entry and lower the baseline'
    ).toEqual([])
  })

  it('counts each ledgered site the way the ledger declares it', () => {
    for (const site of todoSites) {
      expect(extracted.get(`${site.file}\u0000${site.text}`), `${site.file} "${site.text}"`).toBe(
        site.count
      )
    }
  })

  it('keeps the marker total at or below its baseline', () => {
    // Seeded 2026-10-20 at 51 — the tree's current total under the 口径 in
    // the ledger header (PROJECT_GUIDE §13 documented 55 on 2026-09-26; four
    // markers disappeared with later batches). Removing a marker means
    // deleting its entry and lowering this number in the same change.
    const total = [...extracted.values()].reduce((a, b) => a + b, 0)
    expect(
      total,
      'markers grew past the baseline — a new TODO/FIXME/HACK must be justified in the ledger AND the baseline raised in the same change, which is exactly what this ratchet forbids'
    ).toBeLessThanOrEqual(TODO_BASELINE)
    expect(total, 'ledger total drifted from the sources').toBe(
      todoSites.reduce((a, site) => a + site.count, 0)
    )
  })

  it('honors the vendored exclusions and keeps them honest', () => {
    for (const excluded of EXCLUDED) {
      const abs = resolve(REPO_ROOT, excluded.file)
      expect(
        existsSync(abs),
        `${excluded.file} is gone — drop its exclusion: ${excluded.reason}`
      ).toBe(true)
      const markers = readFileSync(abs, 'utf-8')
        .split('\n')
        .filter((line) => (line.match(MARKER) ?? []).length > 0).length
      expect(
        markers,
        `${excluded.file} no longer carries markers — drop the exclusion and ledger whatever remains`
      ).toBeGreaterThan(0)
      expect(
        [...extracted.keys()].filter((key) => key.startsWith(`${excluded.file}\u0000`)),
        `${excluded.file} leaked into the count — it is excluded: ${excluded.reason}`
      ).toEqual([])
    }
  })
})
