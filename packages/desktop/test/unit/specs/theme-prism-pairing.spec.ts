import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #125: PERF-05 moved the theme CSS from `?inline` imports to
// `import.meta.glob`, which turned a missing Prism file from a build failure
// into a silently unhighlighted theme. `loadPrismFile` now throws instead, but
// a unit run cannot see the CSS chunks (`.css` imports are empty under vitest),
// so the pairing itself is pinned against the asset directory here. That is the
// cheap half of the issue's proposal: the keyset check needs no runtime change.

const __dirname = dirname(fileURLToPath(import.meta.url))
const RENDERER = resolve(__dirname, '../../../src/renderer/src')
const THEME_DIR = resolve(RENDERER, 'assets/themes')
const PRISM_DIR = resolve(THEME_DIR, 'prismjs')
const THEME_SOURCE = resolve(RENDERER, 'util/themeColor.ts')

const themeKeys = readdirSync(THEME_DIR)
  .filter((f) => f.endsWith('.theme.css'))
  .map((f) => f.replace(/\.theme\.css$/, ''))
  .sort()

const prismKeys = readdirSync(PRISM_DIR)
  .filter((f) => f.endsWith('.theme.css'))
  .map((f) => f.replace(/\.theme\.css$/, ''))
  .sort()

// The table is an `Object.freeze({ ... })` literal, with some keys quoted
// (`material-dark`) and some bare (`palenight`), so read it as source rather
// than exporting an internal for tests only.
const pairBlock = (): string => {
  const source = readFileSync(THEME_SOURCE, 'utf8')
  const start = source.indexOf('const PRISM_PAIR')
  if (start < 0) throw new Error('PRISM_PAIR not found in themeColor.ts')
  return source.slice(start, source.indexOf('\n})', start))
}

const pairs = (): Array<[theme: string, prism: string]> =>
  [...pairBlock().matchAll(/(?:'([^']+)'|([A-Za-z][\w-]*))\s*:\s*'([^']+)'/g)].map((m) => [
    m[1] ?? m[2],
    m[3]
  ])

describe('built-in theme / Prism asset pairing', () => {
  it('maps every theme file in the directory', () => {
    expect(
      pairs()
        .map(([theme]) => theme)
        .sort()
    ).toEqual(themeKeys)
  })

  it('points every entry at an existing Prism file', () => {
    const targets = new Set(pairs().map(([, prism]) => prism))
    expect([...targets].sort()).toEqual(prismKeys)
  })
})
