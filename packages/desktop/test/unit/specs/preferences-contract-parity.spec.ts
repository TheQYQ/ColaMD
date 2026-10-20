import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { ENCODING_NAME_MAP } from 'common/encoding'
import {
  defaultMismatches,
  enumKeysWithoutUi,
  enumWidenedInTs,
  schemaOnlyKeys,
  tsOnlyKeys,
  uiOptionSources
} from '../utils/preferencesParityLedger'

// The preference contract lives in five copies (see the ledger header). Two
// pairs are already pinned elsewhere: schema.json ↔ static/preference.json by
// preference-schema-parity.spec.ts (O19), and the startUpAction behaviour by
// startup-action.spec.ts. This spec pins the remaining copies to the schema:
//
//   IUserPreferences (TS unions + consts)   ↔ schema enums
//   UI option lists (config.ts / .vue)       ↔ schema enums
//   store pre-load defaults                   ↔ schema defaults
//
// Everything is extracted from source text (the ledger names the symbol or
// radio group), so a copy that drifts fails here by name. Known drift is
// ledgered with a reason and may only shrink — the same ratchet shape
// pathScopeInventory uses.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const readSrc = (rel: string): string => readFileSync(resolve(PKG_ROOT, rel), 'utf-8')

interface ISchemaEntry {
  enum?: unknown[]
  default?: unknown
}

const schema = JSON.parse(readSrc('src/main/preferences/schema.json')) as Record<
  string,
  ISchemaEntry
>
const prefsTs = readSrc('src/shared/types/preferences.ts')
const storeTs = readSrc('src/renderer/src/store/preferences.ts')

/** Enum-valued schema keys and their value lists, narrowed once so tests never
 *  need a non-null assertion on `schema[key].enum`. */
const schemaEnums = new Map<string, unknown[]>()
for (const [key, entry] of Object.entries(schema)) {
  if (Array.isArray(entry.enum)) schemaEnums.set(key, entry.enum)
}
const schemaEnumKeys = [...schemaEnums.keys()].sort()
const enumOf = (key: string): unknown[] => {
  const values = schemaEnums.get(key)
  if (!values) throw new Error(`${key} is not a schema enum key`)
  return values
}

/** Normalizes an enum/default value so `'dfm'` and `dfm`, or `1` and `1.0`,
 *  compare equal while strings and numbers stay distinct. */
const norm = (value: unknown): string =>
  typeof value === 'number' ? `n:${value}` : `s:${String(value)}`
const normSorted = (values: unknown[]): string[] => values.map(norm).sort()

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Returns the content of the first balanced `open`/`close` span at or after
 *  `start`, ignoring delimiters inside quoted strings. */
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

/** `key?: <typeExpr>` lines of IUserPreferences, in declaration order. */
const tsProperties = new Map<string, string>()
{
  const body = /export interface IUserPreferences \{([\s\S]*?)\n\}/.exec(prefsTs)
  if (!body) throw new Error('cannot locate the IUserPreferences interface')
  for (const m of body[1].matchAll(/^\s{2}(\w+)\??:\s*(.+?)\s*$/gm)) {
    tsProperties.set(m[1], m[2])
  }
}

/** Named union type aliases (`export type X = 'a' | 'b'`), so a property typed
 *  `key?: X` resolves to the same literal set as an inline union. */
const typeAliases = new Map<string, string[]>()
for (const m of prefsTs.matchAll(/export type (\w+) = ([^;\n]+)/g)) {
  typeAliases.set(
    m[1],
    [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])
  )
}

/** String literals of a union type expression (or a named alias to one), or
 *  null when the expression carries none (widened to `string`/`number` or
 *  absent). */
const literalUnion = (typeExpr: string | undefined): string[] | null => {
  if (!typeExpr) return null
  const alias = typeAliases.get(typeExpr.trim())
  if (alias) return alias
  const literals = [...typeExpr.matchAll(/'([^']*)'/g)].map((m) => m[1])
  return literals.length > 0 ? literals : null
}

/** Values of an option-list declaration, read from the declaring file's
 *  source. The declaration may be a direct array (`export const x = […]`), an
 *  arrow returning an array (`= () => […]`), an arrow with a block body
 *  (`= () => { return […]; return […] }` — every branch contributes), or a
 *  Vue `computed` wrapper. The block runs to the next `const` declaration. */
const symbolOptionValues = (file: string, symbol: string): Array<string | number> => {
  const src = readSrc(file)
  const decl = new RegExp(`(?:export\\s+)?const\\s+${symbol}\\b`).exec(src)
  if (!decl) throw new Error(`${symbol} is not declared in ${file}`)
  const afterDecl = decl.index + decl[0].length
  const nextDecl = /(?:^|\n)(?:export\s+)?const\s/.exec(src.slice(afterDecl))
  const block = src.slice(decl.index, nextDecl ? afterDecl + nextDecl.index : src.length)
  const values: Array<string | number> = []
  for (const m of block.matchAll(/value:\s*(?:'([^']*)'|(\d+))/g)) {
    values.push(m[1] ?? Number(m[2]))
  }
  // A function with several `return` branches (getFileSortOrderOptions) is
  // captured whole; each branch offers the same value set, so dedupe.
  const unique = [...new Set(values)]
  if (unique.length === 0) throw new Error(`no values extracted for ${symbol} in ${file}`)
  return unique
}

/** Radio `label="…"` values of the el-radio-group bound to `v-model="…"`.
 *  HTML comments are stripped first: a commented-out radio (startUpAction's
 *  hidden `lastState`, #2064) is markup, not an offered option. */
const radioGroupValues = (file: string, model: string): string[] => {
  const src = readSrc(file)
  const at = src.indexOf(`v-model="${model}"`)
  if (at === -1) throw new Error(`no el-radio-group bound to ${model} in ${file}`)
  const end = src.indexOf('</el-radio-group>', at)
  if (end === -1) throw new Error(`unclosed el-radio-group for ${model} in ${file}`)
  const block = src.slice(at, end).replace(/<!--[\s\S]*?-->/g, '')
  const values = [...block.matchAll(/label="([^"]*)"/g)].map((m) => m[1])
  if (values.length === 0) throw new Error(`no radio labels extracted for ${model} in ${file}`)
  return values
}

const uiValues = (key: string): Array<string | number> => {
  const src = uiOptionSources[key]
  if (src.encodingMap) return Object.keys(ENCODING_NAME_MAP)
  if (src.radioModel) return radioGroupValues(src.file, src.radioModel)
  if (src.symbol) return symbolOptionValues(src.file, src.symbol)
  throw new Error(`UI source for "${key}" declares neither encodingMap, radioModel nor symbol`)
}

/** Pre-load defaults of the renderer preferences store, parsed from the
 *  `state: ()` object literal. */
const storeDefaults = new Map<string, unknown>()
{
  const parse = (raw: string): unknown => {
    const text = raw.trim()
    if (text === '[]') return []
    if (text.startsWith("'")) return text.slice(1, -1)
    if (text === 'true') return true
    if (text === 'false') return false
    const num = Number(text)
    return Number.isNaN(num) ? text : num
  }
  const stateAt = storeTs.indexOf('state: (): PreferencesState => ({')
  if (stateAt === -1) throw new Error('cannot locate the preferences store state block')
  const block = balancedBlock(storeTs, storeTs.indexOf('{', stateAt), '{', '}')
  for (const m of block.matchAll(/^\s{4}(\w+):\s*(.+?)(?:,\s*(?:\/\/.*)?)?$/gm)) {
    storeDefaults.set(m[1], parse(m[2]))
  }
}

// ---------------------------------------------------------------------------
// Parity checks
// ---------------------------------------------------------------------------

describe('preferences contract parity (schema ↔ TS mirror ↔ UI ↔ store)', () => {
  it('registers a UI option source for every schema enum key', () => {
    const registered = Object.keys(uiOptionSources).sort()
    expect(
      registered.filter((key) => !schemaEnumKeys.includes(key)),
      'UI sources registered for keys that are not schema enums'
    ).toEqual([])
    expect(
      Object.keys(enumKeysWithoutUi).filter((key) => !schemaEnumKeys.includes(key)),
      'enumKeysWithoutUi entries that are not schema enums'
    ).toEqual([])
    const missing = schemaEnumKeys.filter(
      (key) => !(key in uiOptionSources) && !(key in enumKeysWithoutUi)
    )
    expect(
      missing,
      'schema enum keys without a UI source — register one, or add to enumKeysWithoutUi with a reason'
    ).toEqual([])
  })

  it('offers exactly the schema enum values in the UI', () => {
    for (const key of schemaEnumKeys) {
      if (!(key in uiOptionSources)) continue
      expect(
        normSorted(uiValues(key)),
        `UI options for "${key}" drifted from the schema enum`
      ).toEqual(normSorted(enumOf(key)))
    }
  })

  it('mirrors every schema enum in the TS interface, except ledgered widenings', () => {
    const drifted: string[] = []
    for (const key of schemaEnumKeys) {
      if (key in enumWidenedInTs) continue
      const literals = literalUnion(tsProperties.get(key))
      if (!literals) {
        drifted.push(`${key}: no literal union in IUserPreferences — restore it or ledger it`)
        continue
      }
      if (JSON.stringify(normSorted(literals)) !== JSON.stringify(normSorted(enumOf(key)))) {
        drifted.push(
          `${key}: TS ${JSON.stringify(literals)} vs schema ${JSON.stringify(enumOf(key))}`
        )
      }
    }
    expect(drifted).toEqual([])
  })

  it('ledgers exactly the enum keys whose TS mirror lost its literals', () => {
    const computed = schemaEnumKeys
      .filter((key) => literalUnion(tsProperties.get(key)) === null)
      .sort()
    expect(computed, 'keys whose TS mirror lost its literals').toEqual(
      Object.keys(enumWidenedInTs).sort()
    )
  })

  it('keeps START_UP_ACTIONS equal to the schema enum and the TS union', () => {
    const constMatch = /export const START_UP_ACTIONS[^=]*=\s*\[([\s\S]*?)\]/.exec(prefsTs)
    if (!constMatch) throw new Error('START_UP_ACTIONS const not found in preferences.ts')
    const constValues = [...constMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
    const startUpUnion = literalUnion(tsProperties.get('startUpAction'))
    if (!startUpUnion) throw new Error('startUpAction lost its literal union in IUserPreferences')
    expect(normSorted(constValues)).toEqual(normSorted(enumOf('startUpAction')))
    expect(normSorted(constValues)).toEqual(normSorted(startUpUnion))
  })

  it('ledgers exactly the IUserPreferences keys the schema does not declare', () => {
    const computed = [...tsProperties.keys()].filter((key) => !(key in schema)).sort()
    expect(computed, 'keys declared in TS but unvalidated by the schema').toEqual(
      Object.keys(tsOnlyKeys).sort()
    )
  })

  it('ledgers exactly the schema keys the TS interface does not declare', () => {
    const computed = Object.keys(schema)
      .filter((key) => !tsProperties.has(key))
      .sort()
    expect(computed, 'schema keys with no typed property in IUserPreferences').toEqual(
      [...schemaOnlyKeys].sort()
    )
  })

  it('ships store defaults equal to the schema defaults, except ledgered mismatches', () => {
    const drifted: string[] = []
    for (const [key, entry] of Object.entries(schema)) {
      if (!('default' in entry) || !storeDefaults.has(key)) continue
      const storeValue = storeDefaults.get(key)
      if (norm(storeValue) === norm(entry.default)) continue
      const ledgered = defaultMismatches[key]
      const matchesLedger =
        ledgered !== undefined &&
        norm(parseLedgerValue(ledgered.store)) === norm(storeValue) &&
        norm(parseLedgerValue(ledgered.schema)) === norm(entry.default)
      if (!matchesLedger) {
        drifted.push(
          `${key}: store ${JSON.stringify(storeValue)} vs schema ${JSON.stringify(entry.default)}`
        )
      }
    }
    expect(drifted).toEqual([])
  })

  it('keeps every ledgered default mismatch faithful to both sources', () => {
    const stale: string[] = []
    for (const [key, entry] of Object.entries(defaultMismatches)) {
      const schemaDefault = schema[key]?.default
      if (
        schemaDefault === undefined ||
        norm(parseLedgerValue(entry.schema)) !== norm(schemaDefault)
      ) {
        stale.push(`${key}: ledgered schema value no longer matches schema.json`)
      }
      if (
        !storeDefaults.has(key) ||
        norm(parseLedgerValue(entry.store)) !== norm(storeDefaults.get(key))
      ) {
        stale.push(`${key}: ledgered store value no longer matches the store`)
      }
    }
    expect(stale).toEqual([])
  })
})

/** Parses the string form a ledgered default is written in. */
function parseLedgerValue(raw: string): unknown {
  const text = raw.trim()
  if (text === '[]') return []
  if (text.startsWith("'")) return text.slice(1, -1)
  if (text === 'true') return true
  if (text === 'false') return false
  const num = Number(text)
  return Number.isNaN(num) ? text : num
}

// ---------------------------------------------------------------------------
// Ratchets — each ledger may only shrink
// ---------------------------------------------------------------------------

describe('preferences parity ledgers only shrink', () => {
  it('keeps the widened-TS-enum ledger at or below its baseline', () => {
    // Seeded 2026-10-20 by the first run of this spec: 7 keys. Restoring a
    // literal union removes an entry AND lowers this number — never raise it.
    const BASELINE = 7
    expect(
      Object.keys(enumWidenedInTs).length,
      'widened TS enum mirrors grew — restore the union or the schema entry, do not ledger new drift'
    ).toBeLessThanOrEqual(BASELINE)
  })

  it('keeps the TS-only-keys ledger at or below its baseline', () => {
    const BASELINE = 7
    expect(
      Object.keys(tsOnlyKeys).length,
      'unvalidated TS keys grew — add the schema entry or delete the declaration'
    ).toBeLessThanOrEqual(BASELINE)
  })

  it('keeps the default-mismatch ledger at or below its baseline', () => {
    const BASELINE = 2
    expect(
      Object.keys(defaultMismatches).length,
      'store default mismatches grew — align the store to the schema/static defaults'
    ).toBeLessThanOrEqual(BASELINE)
  })
})
