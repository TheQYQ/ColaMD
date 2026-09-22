import { beforeEach, describe, expect, it, vi } from 'vitest'

// The 28 preference -> engine option mirrors in `useEngineOptionSync` had no
// coverage at all, and their behaviour is three things a reader cannot see from a
// diff: WHICH engine call each preference makes, whether it asks for a re-parse
// (`forceRender`), and the ORDER the watchers are registered in. Order matters
// because a preference broadcast can change several keys in one tick, so a plain
// write landing after a forced re-parse behaves differently than before it.
//
// Every expectation below was written by reading the mirror list by hand, not by
// capturing output. The transcript is compared as strings so a failure names the
// exact preference that drifted.

type Kind = 'options' | 'reparse' | 'indent' | 'font' | 'negate' | 'theme'

interface Mirror {
  /** The registration slot: a ref labelled by its preference name, or the one
   *  function-source watcher (`plantumlServer`), which the fake marks `fn#1`. */
  slot: string
  kind: Kind
  option?: string
}

const MIRRORS: Mirror[] = [
  { slot: 'fontSize', kind: 'options', option: 'fontSize' },
  { slot: 'lineHeight', kind: 'options', option: 'lineHeight' },
  { slot: 'editorFontFamily', kind: 'font', option: 'editorFontFamily' },
  { slot: 'preferLooseListItem', kind: 'options', option: 'preferLooseListItem' },
  { slot: 'tabSize', kind: 'options', option: 'tabSize' },
  { slot: 'theme', kind: 'theme' },
  { slot: 'sequenceTheme', kind: 'reparse', option: 'sequenceTheme' },
  { slot: 'fn#1', kind: 'reparse', option: 'plantumlServer' },
  { slot: 'listIndentation', kind: 'indent' },
  { slot: 'frontmatterType', kind: 'options', option: 'frontmatterType' },
  { slot: 'superSubScript', kind: 'reparse', option: 'superSubScript' },
  { slot: 'footnote', kind: 'reparse', option: 'footnote' },
  { slot: 'mathLatexDelimiters', kind: 'reparse', option: 'mathLatexDelimiters' },
  { slot: 'inlineComment', kind: 'reparse', option: 'inlineComment' },
  { slot: 'definitionList', kind: 'reparse', option: 'definitionList' },
  { slot: 'isHtmlEnabled', kind: 'negate', option: 'disableHtml' },
  {
    slot: 'isGitlabCompatibilityEnabled',
    kind: 'reparse',
    option: 'isGitlabCompatibilityEnabled'
  },
  { slot: 'hideQuickInsertHint', kind: 'options', option: 'hideQuickInsertHint' },
  { slot: 'wrapCodeBlocks', kind: 'options', option: 'wrapCodeBlocks' },
  { slot: 'autoPairBracket', kind: 'options', option: 'autoPairBracket' },
  { slot: 'autoPairMarkdownSyntax', kind: 'options', option: 'autoPairMarkdownSyntax' },
  { slot: 'autoPairQuote', kind: 'options', option: 'autoPairQuote' },
  {
    slot: 'trimUnnecessaryCodeBlockEmptyLines',
    kind: 'options',
    option: 'trimUnnecessaryCodeBlockEmptyLines'
  },
  { slot: 'bulletListMarker', kind: 'options', option: 'bulletListMarker' },
  { slot: 'orderListDelimiter', kind: 'options', option: 'orderListDelimiter' },
  { slot: 'hideLinkPopup', kind: 'options', option: 'hideLinkPopup' },
  { slot: 'autoCheck', kind: 'options', option: 'autoCheck' },
  { slot: 'codeBlockLineNumbers', kind: 'reparse', option: 'codeBlockLineNumbers' }
]

const t = vi.hoisted(() => ({
  registered: [] as Array<{ label: string; cb: (v: unknown, o: unknown) => void }>,
  calls: [] as string[],
  fnWatchers: 0
}))

vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    watch: (
      source: { value: unknown; __label?: string } | (() => unknown),
      cb: (v: unknown, o: unknown) => void
    ) => {
      if (typeof source === 'function') {
        t.fnWatchers++
        t.registered.push({ label: `fn#${t.fnWatchers}`, cb })
      } else {
        t.registered.push({ label: String(source.__label), cb })
      }
    }
  }
})

import { useEngineOptionSync } from '../../../src/renderer/src/components/editorWithTabs/useEngineOptionSync'

const prefs: Record<string, { __label: string; value: unknown }> = {}
for (const m of MIRRORS) {
  if (!m.slot.startsWith('fn#')) prefs[m.slot] = { __label: m.slot, value: undefined }
}

/** Registers the mirrors against a fake engine; `mounted: false` models the
 *  window before an engine instance exists. */
function buildSync(mounted = true): void {
  t.registered.length = 0
  t.calls.length = 0
  t.fnWatchers = 0
  const engine: unknown = {
    setOptions(options: Record<string, unknown>, forceRender?: boolean): void {
      t.calls.push(`setOptions(${JSON.stringify(options)}${forceRender ? ', true' : ''})`)
    },
    setListIndentation(value: unknown): void {
      t.calls.push(`setListIndentation(${JSON.stringify(value)})`)
    }
  }
  const editorRef: { value: unknown } = { value: mounted ? engine : null }
  useEngineOptionSync({
    editor: editorRef,
    preferencesStore: { plantumlServer: 'N' },
    resolveEditorFont: (family: string) => `resolved(${family})`,
    prefs
  } as never)
}

function sample(m: Mirror): unknown {
  if (m.kind === 'theme') return 'anything-dark'
  if (m.kind === 'negate') return true
  if (m.kind === 'indent') return 2
  if (m.kind === 'font') return 'Mono'
  return 'N'
}

function expected(m: Mirror, value: unknown): string {
  if (m.kind === 'indent') return `setListIndentation(${JSON.stringify(value)})`
  if (m.kind === 'theme') {
    return /dark/i.test(String(value))
      ? 'setOptions({"mermaidTheme":"dark","vegaTheme":"dark"}, true)'
      : 'setOptions({"mermaidTheme":"default","vegaTheme":"latimes"}, true)'
  }
  const payload =
    m.kind === 'font'
      ? `{${JSON.stringify(m.option)}:"resolved(${String(value)})"}`
      : m.kind === 'negate'
        ? `{${JSON.stringify(m.option)}:${!value}}`
        : `{${JSON.stringify(m.option)}:${JSON.stringify(value)}}`
  const forced = m.kind === 'reparse' || m.kind === 'negate'
  return `setOptions(${payload}${forced ? ', true' : ''})`
}

describe('engine option mirrors', () => {
  beforeEach(() => {
    buildSync()
  })

  it('registers all 28 mirrors in the original order', () => {
    expect(t.registered.map((r) => r.label)).toEqual(MIRRORS.map((m) => m.slot))
  })

  it('makes the documented engine call for each mirror', () => {
    for (let i = 0; i < MIRRORS.length; i++) {
      const m = MIRRORS[i]
      const value = sample(m)
      t.calls.length = 0
      t.registered[i].cb(value, 'OLD')
      expect(`${m.slot} -> ${t.calls.join(' + ')}`).toBe(`${m.slot} -> ${expected(m, value)}`)
    }
  })

  it('treats a light theme as a re-parse to the light pair', () => {
    const themeIndex = MIRRORS.findIndex((m) => m.kind === 'theme')
    t.calls.length = 0
    t.registered[themeIndex].cb('light-theme', 'anything-dark')
    expect(t.calls[0]).toBe('setOptions({"mermaidTheme":"default","vegaTheme":"latimes"}, true)')
  })

  it('stays silent when the value did not change', () => {
    for (const r of t.registered) {
      t.calls.length = 0
      r.cb('SAME', 'SAME')
      expect(t.calls).toEqual([])
    }
  })

  it('stays silent, and does not throw, before the engine exists', () => {
    buildSync(false)
    for (const r of t.registered) {
      t.calls.length = 0
      expect(() => r.cb('NEW', 'OLD')).not.toThrow()
      expect(t.calls).toEqual([])
    }
  })
})
