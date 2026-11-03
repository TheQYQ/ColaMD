import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  waitForEditor,
  enterSourceMode,
  clickMenuById,
  ensureTocVisible,
  closeApp
} from './helpers'

// colamd #3580: clicking a TOC entry in SOURCE CODE mode must scroll the
// editor to that heading and place it near the TOP of the viewport. Since SB
// (PERF-04) step 3 the editor runs a finite `viewportMargin`, so CodeMirror's
// OWN `.CodeMirror-scroll` is the scrollable element again (the outer
// `.source-code` container no longer overflows).
const HEADING_COUNT = 20
const buildLongDoc = (): string => {
  const parts: string[] = []
  for (let i = 1; i <= HEADING_COUNT; i++) {
    parts.push(`# Heading Number ${i}`)
    for (let p = 0; p < 6; p++) {
      parts.push(`Filler paragraph ${p} under heading ${i}. Lorem ipsum dolor.`)
    }
  }
  return parts.join('\n\n') + '\n'
}

const srcScrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.CodeMirror-scroll') as HTMLElement | null
    return el ? Math.round(el.scrollTop) : -1
  })

// A TOC click animates the scroll, so one reading is a mid-flight value. Wait
// until two consecutive samples agree, then that is the resting position.
const settleScrollTop = async (page: Page): Promise<number> => {
  let last = -1
  await expect
    .poll(
      async () => {
        const now = await srcScrollTop(page)
        const stable = now === last
        last = now
        return stable && now > 0 ? now : -1
      },
      { timeout: 10_000, intervals: [300, 300, 300] }
    )
    .toBeGreaterThan(0)
  return last
}

// Distance of the `# Heading Number N` source line from the top of the
// CodeMirror viewport. Only lines inside the rendered slice exist in the DOM,
// so this is only meaningful once the jump has landed — never before it.
const headingLineTopInViewport = (page: Page, text: string): Promise<number | null> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.CodeMirror-scroll') as HTMLElement | null
    const lines = Array.from(document.querySelectorAll('.source-code .CodeMirror-line'))
    const target = lines.find((l) => (l.textContent || '').includes(needle)) as
      | HTMLElement
      | undefined
    if (!container || !target) return null
    return Math.round(target.getBoundingClientRect().top - container.getBoundingClientRect().top)
  }, `# ${text}`)

test.describe('Source Code mode: TOC click scrolls to the heading at the top', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(buildLongDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await enterSourceMode(page, app)
    const sbVisible = await page.evaluate(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    })
    if (!sbVisible) await clickMenuById(app, 'sideBarMenuItem')
    await ensureTocVisible(app, page)
    await page.waitForFunction(
      (c) => document.querySelectorAll('.side-bar-toc .el-tree-node__label').length >= c,
      HEADING_COUNT,
      { timeout: 10000 }
    )
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('clicking a deep heading scrolls down and lands it near the top', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.CodeMirror-scroll') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => srcScrollTop(page)).toBe(0)

    await page.locator('.side-bar-toc').getByText('Heading Number 18', { exact: true }).click()

    // animated scroll down
    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeGreaterThan(0)
    // Assert the RESTING position. Reading straight after the poll caught the
    // heading mid-flight on CI (-11px, still travelling past the top edge),
    // which is the exact thing the `> -5` bound is meant to reject.
    await settleScrollTop(page)
    const deepTop = (await headingLineTopInViewport(page, 'Heading Number 18')) ?? -999
    // heading sits near the TOP of the viewport (not the bottom)
    expect(deepTop).toBeLessThan(150)
    expect(deepTop).toBeGreaterThan(-5)
  })

  test('clicking an earlier heading scrolls back up to it at the top', async () => {
    // Scrolls down here instead of reusing the position the test above left: a
    // CI retry re-runs a failed test alone against a fresh app, where the
    // editor starts at scrollTop 0 and the old `fromTop > 0` could not hold.
    await page.locator('.side-bar-toc').getByText('Heading Number 18', { exact: true }).click()
    // Read the resting position, not a frame of the animation: comparing the
    // next click against a mid-flight value made this fail whenever the case
    // ran without its predecessor.
    const fromTop = await settleScrollTop(page)
    await page.locator('.side-bar-toc').getByText('Heading Number 3', { exact: true }).click()
    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeLessThan(fromTop)
    await settleScrollTop(page)
    expect((await headingLineTopInViewport(page, 'Heading Number 3')) ?? -999).toBeLessThan(150)
  })
})
