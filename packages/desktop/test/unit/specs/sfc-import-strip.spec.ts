import { describe, expect, it } from 'vitest'
import { stripTopLevelImports } from '../sfcScriptHarness'

// The two SFC-driving specs compile a real `<script setup>` and evaluate it with
// imports swapped for an injected dependency object. Their import removal used to
// be line based, so a reformatted (multi-line) import left its specifiers behind
// as an expression statement and every case in the file died with
// `ReferenceError: X is not defined`. These are the shapes that formatter can
// produce.

describe('stripTopLevelImports', () => {
  it('removes a single-line import with a brace list', () => {
    const code = ["import { a, b } from 'x'", 'const c = a + b'].join('\n')
    expect(stripTopLevelImports(code)).toBe('const c = a + b')
  })

  it('removes a side-effect import and a default import', () => {
    const code = ["import 'styles.css'", "import log from 'electron-log'"].join('\n')
    expect(stripTopLevelImports(code).trim()).toBe('')
  })

  it('removes every line of a multi-line import, leaving no specifier behind', () => {
    const code = [
      'import {',
      '  findMarkdownHeadingLine,',
      '  scrollSourceEditorToLine,',
      '  findActiveHeadingIndex',
      "} from '@/util/sourceModeToc'",
      'const go = () => findMarkdownHeadingLine(1)'
    ].join('\n')
    const out = stripTopLevelImports(code)
    expect(out).toBe('const go = () => findMarkdownHeadingLine(1)')
    // The regression itself: the old filter kept these three lines.
    for (const leftover of ['findMarkdownHeadingLine,', 'scrollSourceEditorToLine,']) {
      expect(out.split('\n').filter((l) => l.trim() === leftover)).toEqual([])
    }
  })

  it('removes a multi-line type import too', () => {
    const code = [
      'import type {',
      '  EditorState,',
      '  TabState',
      "} from '@/store/editor'",
      'type Local = EditorState'
    ].join('\n')
    expect(stripTopLevelImports(code)).toBe('type Local = EditorState')
  })

  it('does not eat statements that merely contain braces', () => {
    const code = ["import { a } from 'x'", 'const obj = {', '  a: 1', '}', 'a()'].join('\n')
    expect(stripTopLevelImports(code)).toBe('const obj = {\n  a: 1\n}\na()')
  })

  it('keeps blank lines and untouched code verbatim', () => {
    const code = '// a comment\nconst x = 1\n\nif (x) {\n  x\n}\n'
    expect(stripTopLevelImports(code)).toBe(code)
  })
})
