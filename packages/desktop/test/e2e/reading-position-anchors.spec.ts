import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { ensureTocVisible, enterSourceMode, launchWithMarkdown } from './helpers'

// O14 ④ — the two "keep the reading position" capabilities from Phase 1/2:
//
//   1. the sidebar outline follows the viewport (editor.vue:1071 `updateActiveTocEntry`
//      → `toc-active-changed` → toc.vue:119 `setCurrentKey`), and
//   2. entering Source Code mode opens on the caret's line instead of line 1
//      (editor.vue:705 computes `muyaIndexCursor` just-in-time, sourceCode.vue:561
//      selects it and scrolls the outer container to that line).
//
// Both were listed as zero-E2E. The neighbouring specs cover the *other*
// directions — `toc-scroll.spec.ts` is click→scroll, `source-toc-scroll.spec.ts`
// is click→scroll in source mode, `external-reload-undo.spec.ts` is reload→
// scroll — so nothing pinned scroll→highlight or WYSIWYG→source caret handoff.
//
// Reading time is not in here because it already has one: `editor-input.spec.ts:175`
// cycles to the fourth mode and pins `ceil(words / 200)`.

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

const MARKER_LINE = 'filler line 42 with some words'
// Blank-line separated, so each line is its own paragraph in the WYSIWYG render
// and its own CodeMirror line in the source render — the two line numbers the
// test compares are then the same thing.
const caretDoc =
  Array.from({ length: 45 }, (_, i) => `filler line ${i} with some words`).join('\n\n') + '\n'

test.describe('Outline follows the viewport', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(outlineDoc)
    app = launched.app
    page = launched.page
    await ensureTocVisible(app, page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('scrolling the editor moves the outline highlight to that section', async() => {
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

test.describe('Entering Source Code mode keeps the caret line', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(caretDoc)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('the source editor opens on the line the WYSIWYG caret was on', async() => {
    // `mu-plain-text` rather than its `mu-paragraph-content` parent: Playwright's
    // `:text-is` only matches the smallest element holding the text.
    await page.locator(`span.mu-plain-text:text-is("${MARKER_LINE}")`).click()

    const caretLineText = async(): Promise<string> =>
      await page.evaluate(() => {
        const host = document.querySelector('.source-code .CodeMirror') as
          | (Element & { CodeMirror?: { getCursor(): { line: number }; getValue(): string } })
          | null
        const cm = host?.CodeMirror
        if (!cm) return ''
        return cm.getValue().split('\n')[cm.getCursor().line] ?? ''
      })

    const sourceScrollTop = async(): Promise<number> =>
      await page.evaluate(() => {
        const el = document.querySelector('.source-code') as HTMLElement | null
        return el ? el.scrollTop : -1
      })

    await enterSourceMode(page, app)

    // The handoff: CodeMirror's selection sits on the clicked markdown line, and
    // the outer container (viewportMargin: Infinity means CodeMirror itself never
    // scrolls) is moved down to it rather than left at the top of the document.
    await expect.poll(caretLineText, { timeout: 5000 }).toBe(MARKER_LINE)
    await expect.poll(sourceScrollTop, { timeout: 5000 }).toBeGreaterThan(0)
  })
})
