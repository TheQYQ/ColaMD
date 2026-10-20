import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { IPC_UNKNOWN_BASELINE, ipcUnknownSites } from '../utils/ipcUnknownLedger'

// The IPC contract's `unknown` payloads are ratcheted debt, not a free-for-all.
// The contract header points here; this spec extracts every unknown site from
// shared/types/ipc.ts and requires an exact match with the ledger, so a new
// `unknown` anywhere in the file fails by locator, and the total may only
// shrink (fix a site → delete its ledger entry → lower the baseline).
//
// Sites are attributed two ways: channel entries inside the four channel
// tables, and the payload interfaces declared outside them (a nested
// `currentFile: unknown` counts against its interface, not the channel that
// happens to reference it).

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const CONTRACT_REL = 'src/shared/types/ipc.ts'

const CHANNEL_TABLES = [
  'IpcInvokeChannels',
  'IpcSendChannels',
  'IpcSyncChannels',
  'IpcMainEventChannels'
] as const

/** Content of the first balanced `open`/`close` span whose opener is at or
 *  after `start`, ignoring delimiters inside quoted strings. */
const balancedBlock = (src: string, start: number, open: string, close: string): string => {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced ${open}${close} block starting at index ${start}`)
}

const countUnknown = (text: string): number => (text.match(/\bunknown\b/g) ?? []).length

// Comments are stripped before extraction: the header prose talks about
// `unknown` on purpose and must not inflate the count. Channel names use
// `::`, so stripping `//` cannot eat a declaration.
const stripped = readFileSync(resolve(PKG_ROOT, CONTRACT_REL), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

/** Channel entries of one table: `'mt::x': …` (possibly multi-line) → text. */
const tableEntries = (tableName: string): Map<string, string> => {
  const at = stripped.indexOf(`interface ${tableName} {`)
  if (at === -1) throw new Error(`${tableName} not found in the contract`)
  const body = balancedBlock(stripped, stripped.indexOf('{', at), '{', '}')
  const entries = new Map<string, string>()
  let current: string | null = null
  let buffer: string[] = []
  const flush = (): void => {
    if (current !== null) entries.set(current, buffer.join('\n'))
  }
  for (const line of body.split('\n')) {
    const start = /^\s{2}'([^']+)'\s*:/.exec(line)
    if (start) {
      flush()
      current = start[1]
      buffer = [line]
    } else if (current !== null) {
      buffer.push(line)
    }
  }
  flush()
  return entries
}

/** Every top-level interface outside the four channel tables: name → body. */
const payloadInterfaces = new Map<string, string>()
const ifaceRe = /^(?:export\s+)?interface\s+(\w+)[^{]*\{/gm
let ifaceMatch: RegExpExecArray | null
while ((ifaceMatch = ifaceRe.exec(stripped)) !== null) {
  const name = ifaceMatch[1]
  if ((CHANNEL_TABLES as readonly string[]).includes(name)) continue
  payloadInterfaces.set(
    name,
    balancedBlock(stripped, ifaceMatch.index + ifaceMatch[0].length - 1, '{', '}')
  )
}

const extracted = new Map<string, number>()
for (const table of CHANNEL_TABLES) {
  for (const [channel, decl] of tableEntries(table)) {
    const n = countUnknown(decl)
    if (n > 0) extracted.set(channel, n)
  }
}
for (const [name, body] of payloadInterfaces) {
  const n = countUnknown(body)
  if (n > 0) extracted.set(name, n)
}

const ledger = new Map(ipcUnknownSites.map((site) => [site.locator, site.count]))

describe('IPC unknown payload ledger', () => {
  it('registers every unknown site in the contract, with no stale entries', () => {
    const unledgered = [...extracted].filter(([locator, n]) => ledger.get(locator) !== n)
    const stale = [...ledger].filter(([locator]) => !extracted.has(locator))

    expect(
      unledgered.map(
        ([locator, n]) =>
          `${locator}: ${n} unknown token(s), ledger says ${ledger.get(locator) ?? 'nothing'}`
      ),
      'unknown sites in the contract that the ledger does not match — add a ledger entry with a reason, or tighten the channel'
    ).toEqual([])
    expect(
      stale.map(([locator]) => locator),
      'ledger entries whose unknown is gone — delete the entry and lower the baseline'
    ).toEqual([])
    expect([...extracted.keys()].sort()).toEqual([...ledger.keys()].sort())
  })

  it('counts each ledgered site the way the ledger declares it', () => {
    for (const site of ipcUnknownSites) {
      expect(extracted.get(site.locator), `${site.locator} token count`).toBe(site.count)
    }
  })

  it('keeps the unknown total at or below its baseline', () => {
    // Seeded at 35 when the ledger was created (2026-10-20); batch 1 tightened
    // 11 sites (five mt::rg::* envelopes, four mt::UPDATE_* messages,
    // mt::keybindings-response, mt::set-view-layout) and lowered it to 24.
    // Wiring the emit sites also caught a latent null match payload from a
    // malformed ripgrep stream — tightening is a bug-finding pass, not just
    // cosmetics.
    const total = [...extracted.values()].reduce((a, b) => a + b, 0)
    expect(
      total,
      'unknown payloads grew past the baseline — new unknowns must be justified in the ledger AND the baseline raised in the same change, which is exactly what this ratchet forbids'
    ).toBeLessThanOrEqual(IPC_UNKNOWN_BASELINE)
    expect(total, 'ledger total drifted from the contract').toBe(
      ipcUnknownSites.reduce((a, site) => a + site.count, 0)
    )
  })
})
