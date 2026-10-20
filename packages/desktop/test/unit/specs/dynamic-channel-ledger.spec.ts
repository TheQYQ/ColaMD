import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { EXEMPTION_BASELINE, channelExemptions } from '../utils/dynamicChannelLedger'

// The machine shadow of ESLint §11's exemption list and of the "no
// runtime-built channel names" invariant. ESLint bans bare ipcMain.handle/on
// and X.webContents.send in src/main; the handful of sites that legitimately
// need them carry `eslint-disable-next-line no-restricted-syntax` comments,
// and every one of those must be registered in dynamicChannelLedger.ts:
//
//   - a disable with no ledger entry fails the reconciliation — someone
//     pulled a channel out of the contract
//   - a ledger entry whose site text changed fails as stale — the exemption
//     must be re-justified, not silently carried
//   - the exemption count is ratcheted at EXEMPTION_BASELINE (4)
//   - across all of src, no IPC call may build its channel name at runtime
//     (template literal or concatenation), and no ipcRenderer method may be
//     cast to a string-channel signature — both are zero-ratchets. The three
//     families that used to need this (`mt::response-of-image-path-${id}`,
//     `mt::window-${channel}`, `EVENT_NAME[type]`) were collapsed into the
//     contract on 2026-10-20; see the ledger header.
//
// Sites are keyed by file + the code line the disable applies to, never by
// line number: the pair travels with the code when it moves.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const REPO_ROOT = resolve(PKG_ROOT, '../..')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'lib'])

/** Repo-root relative .ts/.vue files under a package-relative directory. */
const walk = (absDir: string, relDir: string, out: string[]): void => {
  for (const name of readdirSync(absDir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(absDir, name)
    const rel = relDir ? `${relDir}/${name}` : name
    if (statSync(abs).isDirectory()) walk(abs, rel, out)
    else if (/\.(ts|vue)$/.test(name)) out.push(rel)
  }
}

const readRepoLines = (rel: string): string[] =>
  readFileSync(resolve(REPO_ROOT, rel), 'utf-8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))

// --- exemption extraction (§11 applies to src/main/**/*.ts) ------------------

const mainFiles: string[] = []
walk(resolve(REPO_ROOT, 'packages/desktop/src/main'), 'packages/desktop/src/main', mainFiles)

const DISABLE_COMMENT = /^\s*\/\/ eslint-disable-next-line no-restricted-syntax\b/

interface FoundExemption {
  file: string
  /** Trimmed code line the disable applies to. */
  site: string
}

const found: FoundExemption[] = []
for (const file of mainFiles) {
  const lines = readRepoLines(file)
  lines.forEach((text, i) => {
    if (!DISABLE_COMMENT.test(text)) return
    const site = (lines[i + 1] ?? '').trim()
    if (!site) throw new Error(`${file}: disable comment with no following code line`)
    found.push({ file, site })
  })
}

// --- runtime-built channel names (all of src) --------------------------------

const srcFiles: string[] = []
walk(resolve(REPO_ROOT, 'packages/desktop/src'), 'packages/desktop/src', srcFiles)

// IPC method names whose first argument is a channel. Anchored on the call so
// log messages and comments that merely mention a channel shape stay legal.
const IPC_METHODS = '(?:send|on|once|invoke|handle|emit|sendSync|removeListener|removeAllListeners)'
const TEMPLATE_CHANNEL = new RegExp(`\\.${IPC_METHODS}\\(\\s*\`(?:mt::|settings::)[^\`]*\\$\\{`)
const CONCAT_CHANNEL = new RegExp(`\\.${IPC_METHODS}\\(\\s*'(?:mt::|settings::)[a-z0-9:-]+'\\s*\\+`)
// Casting the method itself (`ipcRenderer.once as (channel: string, …)`) is
// how the old per-request listener bypassed the typed preload wrapper.
const METHOD_CAST = /ipcRenderer\.\w+\s+as\s*\(/

const runtimeBuilt: string[] = []
const methodCasts: string[] = []
for (const file of srcFiles) {
  for (const text of readRepoLines(file)) {
    const label = `${file}: ${text.trim()}`
    if (TEMPLATE_CHANNEL.test(text) || CONCAT_CHANNEL.test(text)) runtimeBuilt.push(label)
    if (METHOD_CAST.test(text)) methodCasts.push(label)
  }
}

// --- tests -------------------------------------------------------------------

describe('dynamic IPC channels', () => {
  it('registers every remaining §11 exemption, with no stale entries', () => {
    const key = (file: string, site: string): string => `${file}\u0000${site}`
    const ledger = new Map(channelExemptions.map((e) => [key(e.file, e.site), e]))
    const seen = new Map<string, number>()
    for (const { file, site } of found) {
      const k = key(file, site)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }

    const unregistered = [...seen.keys()].filter((k) => !ledger.has(k))
    const stale = [...ledger.keys()].filter((k) => !seen.has(k))
    const wrongCount = [...ledger.entries()]
      .filter(([k, e]) => seen.has(k) && seen.get(k) !== e.count)
      .map(
        ([k, e]) =>
          `${k.replace('\u0000', ' — ')}: ledger says ×${e.count}, tree has ×${seen.get(k)}`
      )

    expect(
      unregistered.map((k) => k.replace('\u0000', ' — ')),
      'bare IPC calls with no ledger entry — pull the channel back into the contract or register it with a reason'
    ).toEqual([])
    expect(
      stale.map((k) => k.replace('\u0000', ' — ')),
      'ledger entries whose site no longer exists — the exemption must be re-justified, not silently carried'
    ).toEqual([])
    expect(wrongCount, 'ledger counts that disagree with the tree').toEqual([])
  })

  it('keeps the exemption count at or below its baseline', () => {
    const total = found.length
    expect(
      total,
      '§11 exemptions grew past the baseline — a new exemption means a channel escaped the contract'
    ).toBeLessThanOrEqual(EXEMPTION_BASELINE)
    const ledgerTotal = channelExemptions.reduce((sum, e) => sum + e.count, 0)
    expect(ledgerTotal, 'the ledger must account for exactly the baseline').toBe(EXEMPTION_BASELINE)
  })

  it('builds no IPC channel name at runtime', () => {
    expect(
      runtimeBuilt,
      'channel names built with a template literal or concatenation — express the channel in shared/types/ipc.ts (a static lookup table of contract keys is fine)'
    ).toEqual([])
  })

  it('casts no ipcRenderer method to a string-channel signature', () => {
    expect(
      methodCasts,
      'ipcRenderer methods cast to accept arbitrary channel strings — the typed preload wrapper covers every contract channel'
    ).toEqual([])
  })
})
