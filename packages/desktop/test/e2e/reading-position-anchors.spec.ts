import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { ensureTocVisible, enterSourceMode, launchWithMarkdown } from './helpers'

// O14 ④ — the two "keep the reading position" capabilities from Phase 1/2:
//
//   1. the sidebar outline follows the viewport (editor.vue:1071 `updateActiveTocEntry`
//      → `toc-active-changed` → toc.vue:119 `setCurrentKey`), and
//   2. the scroll half of the WYSIWYG → Source Code handoff (editor.vue:705
//      computes `muyaIndexCursor` just-in-time; sourceCode.vue:561 selects it and
//      sourceCode.vue:568 then scrolls the outer container to that line).
//
// What the neighbouring specs already own, and what therefore is *not* repeated
// here: `toc-scroll.spec.ts` and `source-toc-scroll.spec.ts` are click→scroll,
// `external-reload-undo.spec.ts` is reload→scroll, `parity-source-undo-saved.spec.ts:33`
// is the source→WYSIWYG caret restore, and `parity-cursor-lang.spec.ts:97`
// already pins the caret *line* of this same handoff. Only its scroll position had
// no assertion, so the caret check below exists to make the scroll check
// non-vacuous, not to compete with G7. Reading time, also on the O14 ④ list,
// already has `editor-input.spec.ts:175` cycling to the fourth mode.

const SECTIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta']

// Every section is far enough from the next that the viewport can hold only one
// of them — the highlight rule keys off "the last heading above 30% of the
// viewport", which needs real vertical distance to be distinguishable. The tail
// after the last heading matters for the same reason: without it the container
// stops scrolling before the final heading can be pulled down past the
// threshold.
const outlineDoc =
  SECTIONS.map(
    (name, i) =>
      `# ${name}\n\n` +
      Array.from(
        { length: 8 },
        (_, k) => `body ${i}.${k} paragraph carrying the section down.`
      ).join('\n\n') +
      '\n'
  ).join('\n') +
  '\n' +
  Array.from({ length: 12 }, (_, k) => `tail ${k} paragraph below the last heading.`).join('\n\n') +
  '\n'

// The scroll container is muya's root (`.mu-editor`, also `.editor-component`);
// `.mu-container` is the inner page. Move the viewport so that the heading whose
// text matches `name` sits at a quarter of the height — under the 30% threshold
// the source uses, and far from the next heading.
const scrollToHeading = (page: Page, name: string): Promise<void> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.editor-component') as HTMLElement | null
    if (!container) return
    const headings = Array.from(
      container.querySelectorAll('.mu-atx-heading, .mu-setext-heading')
    ) as HTMLElement[]
    const clean = (el: HTMLElement): string => (el.textContent || '').replace(/^[#\s]+/, '').trim()
    const target = headings.find((h) => clean(h) === needle)
    if (!target) return
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    container.scrollTop = Math.max(0, top - container.clientHeight * 0.25)
  }, name)

const currentTocLabel = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const nodes = document.querySelectorAll('.side-bar-toc .el-tree-node.is-current')
    // Exactly one node may carry the highlight; two would make the assertion below
    // pass for the wrong reason.
    if (nodes.length !== 1) return `__count__${nodes.length}`
    const label = nodes[0].querySelector(':scope > .el-tree-node__content .el-tree-node__label')
    return label ? (label.textContent || '').trim() : null
  })

// Blank-line separated, so each line is its own paragraph in the WYSIWYG render
// and its own CodeMirror line in the source render — the two line numbers the
// test compares are then the same thing. The marker sits well above the last
// screenful on purpose: the mount code assigns `scrollTop = heightAtLine(caretLine)`
// and a browser clamps an over-large scrollTop to `scrollHeight - clientHeight`
// (measured: a caret on source line 84 of a 2123 px document landed on 1411,
// exactly that clamp), so only a mid-document caret shows the handoff as a
// scroll position rather than as "scrolled to the bottom".
const MARKER_LINE = 'filler line 20 with some words'
const caretDoc =
  Array.from({ length: 60 }, (_, i) => `filler line ${i} with some words`).join('\n\n') + '\n'

test.describe('Outline follows the viewport', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(outlineDoc)
    app = launched.app
    page = launched.page
    await ensureTocVisible(app, page)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('scrolling the editor moves the outline highlight to that section', async () => {
    // Downward first: the highlight is recomputed inside the container's `scroll`
    // handler, so a document that has never scrolled has no event to compute
    // from. Scroll to the top from there and the same rule points at Alpha.
    for (const name of ['Charlie', 'Delta', 'Bravo']) {
      await scrollToHeading(page, name)
      await expect.poll(() => currentTocLabel(page), { timeout: 5000 }).toBe(name)
    }

    await page.evaluate(() => {
      const container = document.querySelector('.editor-component') as HTMLElement | null
      if (container) container.scrollTop = 0
    })
    // The highlight follows, it does not latch.
    await expect.poll(() => currentTocLabel(page), { timeout: 5000 }).toBe('Alpha')
  })
})

// CodeMirror 5 ships no first-party types, and only the three members read here
// are declared. Named rather than an inline literal because writing the same
// shape nested inside the cast tripped @stylistic/indent six times over
// (`Expected indentation of 12 spaces but found 14`); this keeps the cast to
// one line.
interface SourceCodeMirror {
  getCursor(): { line: number }
  getValue(): string
  heightAtLine(line: number, mode: string): number
}

test.describe('Entering Source Code mode scrolls to the caret', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(caretDoc)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('the source editor opens scrolled to the line the WYSIWYG caret was on', async () => {
    // `mu-plain-text` rather than its `mu-paragraph-content` parent: Playwright's
    // `:text-is` only matches the smallest element holding the text.
    await page.locator(`span.mu-plain-text:text-is("${MARKER_LINE}")`).click()

    const readHandoff = async (): Promise<{
      caretLineText: string
      scrollTop: number
      scrolledToCaret: boolean
    }> =>
      await page.evaluate(() => {
        const host = document.querySelector('.source-code .CodeMirror') as
          | (Element & { CodeMirror?: SourceCodeMirror })
          | null
        const cm = host?.CodeMirror
        const container = document.querySelector('.source-code') as HTMLElement | null
        if (!cm || !container) return { caretLineText: '', scrollTop: -1, scrolledToCaret: false }
        const line = cm.getCursor().line
        return {
          caretLineText: cm.getValue().split('\n')[line] ?? '',
          scrollTop: container.scrollTop,
          // CodeMirror itself never scrolls (`viewportMargin: Infinity`), so the
          // reading position is the outer container's, measured against the same
          // line height the mount code used. Tolerance because a compositor can
          // round the applied scroll offset.
          scrolledToCaret: Math.abs(container.scrollTop - cm.heightAtLine(line, 'local')) <= 2
        }
      })

    await enterSourceMode(page, app)

    // G7 (parity-cursor-lang.spec.ts:97) owns this half, and it is also what
    // makes the two below non-vacuous: on line 0 a scrollTop of 0 would match too.
    await expect
      .poll(async () => (await readHandoff()).caretLineText, { timeout: 5000 })
      .toBe(MARKER_LINE)

    // The unasserted half: sourceCode.vue:568 moved the container down to that
    // line, rather than leaving the source view at the top of the document.
    await expect
      .poll(async () => (await readHandoff()).scrollTop, { timeout: 5000 })
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await readHandoff()).scrolledToCaret, { timeout: 5000 })
      .toBe(true)
  })
})
