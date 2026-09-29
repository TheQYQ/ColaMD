import { beforeAll, describe, expect, it } from 'vitest'
import QuickOpenCommand from '@/commands/quickOpen'

// #27 item 3. `_getInclusions()` handed the raw query to `rg --iglob`, where
// `[` `]` `{` `}` `?` are glob syntax. Measured with the bundled ripgrep
// (15.0.0, `packages/desktop/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe`)
// against a directory holding both `a[1].md` and `a1.md`:
//
//   --iglob '*a[1].md'   -> a1.md        (the file the query named was missed)
//   --iglob '*a{.md'     -> exit 2       (rg errored; the panel showed nothing)
//   --iglob '*a[[]1[]].md' -> a[1].md    (one-element bracket class: literal)
//
// A bracket class is used rather than the usual `\` escape because
// `prepareGlobs` (`src/main/ipc/ripgrep.ts:142`) rewrites every `path.sep` in
// the pattern to `/`, which would eat the backslash on Windows.

const MARKDOWN_INCLUSIONS = ['.md', '.markdown']

beforeAll(() => {
  const w = globalThis as unknown as {
    window: {
      fileUtils?: {
        hasMarkdownExtension: (p: string) => boolean
        MARKDOWN_INCLUSIONS: string[]
      }
    }
  }
  w.window.fileUtils = {
    MARKDOWN_INCLUSIONS,
    hasMarkdownExtension: (p: string) => MARKDOWN_INCLUSIONS.some((ext) => p.endsWith(ext))
  }
})

const inclusionsFor = (query: string): string[] =>
  new QuickOpenCommand({
    editor: { tabs: [] },
    project: { projectTree: { pathname: '/root' } }
  } as unknown as ConstructorParameters<typeof QuickOpenCommand>[0])._getInclusions(query)

describe('quick open: the query as a ripgrep glob', () => {
  it('leaves an ordinary query untouched', () => {
    expect(inclusionsFor('note')).toEqual(['*note.md', '*note.markdown'])
  })

  it('makes every glob metacharacter literal', () => {
    expect(inclusionsFor('a[1]b{2}c?')).toEqual([
      '*a[[]1[]]b[{]2[}]c[?].md',
      '*a[[]1[]]b[{]2[}]c[?].markdown'
    ])
  })

  it('escapes on the branch where the query already carries an extension', () => {
    expect(inclusionsFor('a[1].md')).toEqual(['*a[[]1[]].md'])
  })

  it('keeps a star working as the glob wildcard it is meant to be', () => {
    expect(inclusionsFor('no*es')).toEqual(['*no*es.md', '*no*es.markdown'])
  })
})
