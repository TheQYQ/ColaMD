import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  waitForEditor,
  ensureTocVisible,
  closeApp,
  enterSourceMode
} from './helpers'

// SB (PERF-04) step 3: Source Code mode runs CodeMirror with a finite
// viewportMargin (and a definite wrapper height), so CM's own viewport
// virtualization works again — a huge document renders only the visible
// lines — and the sidebar TOC scroll targets CM's scroller.

const LINES = 5000

const buildDoc = (): string => {
  const lines: string[] = []
  for (let i = 0; i < LINES; i++) {
    if (i % 100 === 0) lines.push(`# Heading ${i / 100}`)
    lines.push(`source line ${i} with some filler text`)
  }
  return lines.join('\n')
}

test.describe('source mode viewport virtualization', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(buildDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await enterSourceMode(page, app)
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('renders a viewport-sized slice of a huge document, not every line', async () => {
    const rendered = await page.evaluate(() => document.querySelectorAll('.CodeMirror-line').length)
    // `viewportMargin` is a count of LINES, not pixels (CM5 default 10). At 200
    // a ~5,050-line document renders ~230 lines: the visible slice plus 200
    // above and below. Infinity rendered all of them, so this upper bound is
    // what would fail if the option ever went back.
    expect(rendered).toBeGreaterThan(20)
    expect(rendered).toBeLessThan(1200)
  })

  test('sidebar TOC scroll moves CodeMirror scroller to the heading line', async () => {
    await ensureTocVisible(app, page)
    const label = page.locator('.side-bar-toc').getByText('Heading 40', { exact: true })
    await expect(label).toBeVisible()
    await label.click()

    // CM's own scroller must carry the scroll (the outer .source-code
    // container no longer overflows with a finite viewportMargin). The scroll
    // is animated, so poll — reading scrollTop once caught the animation in
    // flight at 2937/90490 and failed for the wrong reason.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const scroller = document.querySelector('.CodeMirror-scroll') as HTMLElement | null
            return scroller ? scroller.scrollTop : -1
          }),
        { timeout: 8000 }
      )
      .toBeGreaterThan(10_000)

    // Wait until the scroller has genuinely stopped — including the correction
    // pass `scrollSourceEditorToLine` runs once the target is rendered. The
    // oracle is "two readings 150ms apart agree", because every simpler check
    // has a false-green: polling a boolean while the heading sweeps through the
    // viewport reports true mid-flight, and a plain "scrollTop unchanged for N
    // frames" fires in the gap between the first landing and the correction's
    // second scroll (measured: it read the pre-correction 36px).
    const stableOffset = async (): Promise<number> => {
      const read = (): Promise<number> =>
        page.evaluate(() => {
          const scroller = document.querySelector('.CodeMirror-scroll') as HTMLElement | null
          const line = [...document.querySelectorAll('.CodeMirror-line')].find((el) =>
            (el.textContent || '').includes('# Heading 40')
          )
          if (!line || !scroller) return Number.NaN
          return Math.round(line.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
        })
      const first = await read()
      await page.waitForTimeout(150)
      const second = await read()
      return first === second ? first : Number.NaN
    }

    // The heading must rest at the top edge: not below it (the jump fell short)
    // and not above it (the jump overshot and cut the heading off). 2px is the
    // tolerance the correction loop in sourceModeToc.ts settles for; NaN means
    // "still moving", which keeps the poll going.
    await expect
      .poll(stableOffset, { timeout: 8000, intervals: [150, 200, 300] })
      .toBeLessThanOrEqual(2)
  })
})
