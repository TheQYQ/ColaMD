import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// O19 — the preferences have three declarations: the JSON Schema main validates
// against, the static defaults main merges into a settings file, and the renderer
// store. Only the first two are machine-checkable against each other, so this
// spec pins them together: a key in one and not the other is how `treePathExcludePatterns`
// sat undeclared in the schema while main read it (`filesystem/watcher.ts:272`).

const SCHEMA_PATH = path.join(__dirname, '../../../src/main/preferences/schema.json')
const STATIC_PATH = path.join(__dirname, '../../../static/preference.json')

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as Record<
  string,
  { description?: string; type?: string; default?: unknown; enum?: unknown[] }
>
const staticDefaults = JSON.parse(fs.readFileSync(STATIC_PATH, 'utf8')) as Record<string, unknown>

const schemaKeys = Object.keys(schema)
const staticKeys = Object.keys(staticDefaults)

describe('preference declarations agree', () => {
  it('declares every static default in the schema', () => {
    expect(staticKeys.filter((key) => !(key in schema))).toEqual([])
  })

  it('declares no schema entry the defaults do not ship', () => {
    expect(schemaKeys.filter((key) => !(key in staticDefaults))).toEqual([])
  })

  it('types every entry the same way its default is shaped', () => {
    const shapeOf = (value: unknown): string => {
      if (Array.isArray(value)) return 'array'
      if (value === null) return 'null'
      return typeof value
    }
    const mismatched = schemaKeys.filter((key) => {
      const declared = schema[key].type
      // Enum-only entries (titleBarStyle, startUpAction, …) declare no `type`,
      // which is valid JSON Schema; they are covered by the enum case below.
      if (declared === undefined) return false
      return declared !== shapeOf(staticDefaults[key])
    })
    expect(mismatched).toEqual([])
  })

  it('ships a static default that its own enum allows', () => {
    const rejected = schemaKeys
      .filter((key) => Array.isArray(schema[key].enum))
      .filter((key) => !(schema[key].enum as unknown[]).includes(staticDefaults[key]))
    expect(rejected).toEqual([])
  })

  it('declares the same default the shipped file uses', () => {
    // Which of the two sources wins depends on whether a settings file exists:
    // first run writes static/preference.json wholesale, while a key missing
    // from an existing file (one added in a later release) falls back to the
    // schema default. Six keys disagreed, so upgrading users got a different
    // sidebar sort order, code-block line numbers, code wrapping and
    // theme-following behaviour than fresh installs, and two folder keys read
    // as undefined instead of "". Aligned to the shipped file; this keeps them
    // from drifting apart again.
    const differing = schemaKeys
      .filter((key) => 'default' in schema[key])
      .filter((key) => JSON.stringify(schema[key].default) !== JSON.stringify(staticDefaults[key]))
    expect(differing).toEqual([])
  })

  it('gives every string entry a default so no reader sees undefined', () => {
    const missing = schemaKeys.filter(
      (key) => schema[key].type === 'string' && !('default' in schema[key])
    )
    expect(missing).toEqual([])
  })

  it('declares the file-tree exclusion patterns main reads', () => {
    // Read at filesystem/watcher.ts:59 and app/windowManager.ts:469.
    expect(schema.treePathExcludePatterns).toEqual({
      description: expect.any(String),
      type: 'array',
      items: { type: 'string' },
      default: []
    })
    expect(staticDefaults.treePathExcludePatterns).toEqual([])
  })
})

// O19's remainder is closed by the two default cases above: the six divergences
// were aligned to static/preference.json rather than the other way round, because
// that file is what a fresh install actually gets today.
