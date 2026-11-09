import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  clickMenuById,
  waitForEditor,
  ensureTocVisible,
  closeApp
} from './helpers'

// Build a long document with many top-level headings so the editor content
// overflows its scroll container. Each heading title is unique so the sidebar
// TOC (an el-tree) renders an unambiguous label we can click. Filler paragraphs
// between headings push later headings far down the scroll, so revealing a deep
// heading requires a real (non-zero) scroll.
const HEADING_COUNT = 20
const buildLongDoc = (): string => {
  const parts: string[] = []
  for (let i = 1; i <= HEADING_COUNT; i++) {
    parts.push(`# Heading Number ${i}`)
    // Several filler paragraphs so each section is taller than the viewport.
    for (let p = 0; p < 6; p++) {
      parts.push(
        `Filler paragraph ${p} under heading ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`
      )
    }
  }
  return parts.join('\n\n') + '\n'
}

// Read the live editor scroll container's scrollTop. The scroll container is
// muya's root element (`.mu-editor`, which also carries `.editor-component`),
// NOT `.mu-container` (the inner scrollPage that holds the headings).
const getScrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.editor-component') as HTMLElement | null
    return el ? el.scrollTop : -1
  })

// A TOC click animates the scroll, so one reading is a mid-flight value. Wait
// until two consecutive samples agree, then that is the resting position.
const settleScrollTop = async (page: Page): Promise<number> => {
  let last = -1
  await expect
    .poll(
      async () => {
        const now = Math.round(await getScrollTop(page))
        const stable = now === last
        last = now
        return stable && now > 0 ? now : -1
      },
      { timeout: 10_000, intervals: [300, 300, 300] }
    )
    .toBeGreaterThan(0)
  return last
}

// Returns the index (in document order, among `.mu-container > hN`) of the
// top-level heading whose text matches `text`, or -1. The live ATX heading
// renders its `# ` syntax marker as part of `textContent`, so we strip leading
// `#`/whitespace before comparing against the clean TOC label text.
// SB (PERF-04) viewport virtualization: deep headings may not be rendered,
// so the index comes from the sidebar TOC tree (an el-tree that renders EVERY
// entry regardless of the editor's virtual window) - its order is the same
// document order `resolveTocHeadingElement` maps against.
const headingIndexByText = (page: Page, text: string): Promise<number> =>
  page.evaluate((needle) => {
    const labels = Array.from(document.querySelectorAll('.side-bar-toc .el-tree-node__label'))
    const normalize = (s: string) => s.replace(/^[#\s]+/, '').trim()
    return labels.findIndex((l) => normalize(l.textContent || '') === needle)
  }, text)

// Is the heading at `index` (in the top-level heading list) within the
// scroll container's visible viewport? Compares the heading rect against the
// container rect rather than the window, so it stays correct regardless of
// sidebar/tab-bar chrome height.
// By TEXT, not positional index: under viewport virtualization the rendered
// heading list is sparse (only the mounted window), so a tree index would
// misalign. An unrendered heading is by definition not in the viewport.
const isHeadingInViewport = (page: Page, text: string): Promise<boolean> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.editor-component') as HTMLElement | null
    if (!container) return false
    const sel =
      '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
    const normalize = (s: string) => s.replace(/^[#\s]+/, '').trim()
    const target = Array.from(document.querySelectorAll(sel)).find(
      (h) => normalize(h.textContent || '') === needle
    ) as HTMLElement | undefined
    if (!target) return false
    const cRect = container.getBoundingClientRect()
    const hRect = target.getBoundingClientRect()
    return hRect.top >= cRect.top - 1 && hRect.top <= cRect.bottom
  }, text)

// Locate a TOC tree node label by its EXACT text. Exact matching avoids the
// substring trap where "Heading Number 1" also matches "Heading Number 18".
const tocLabel = (page: Page, text: string) =>
  page.locator('.side-bar-toc').getByText(text, { exact: true })

// Distance from the scroll container's TOP to the heading's top. The jump
// targets `STANDAR_Y` (320px) below the container top; comparing window-relative
// coordinates instead would silently absorb the title bar + menu bar height.
const headingOffsetFromContainerTop = (page: Page, text: string): Promise<number> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.editor-component') as HTMLElement | null
    if (!container) return -1
    const sel =
      '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
    const normalize = (s: string) => s.replace(/^[#\s]+/, '').trim()
    const target = Array.from(document.querySelectorAll(sel)).find(
      (h) => normalize(h.textContent || '') === needle
    ) as HTMLElement | undefined
    if (!target) return -1
    return Math.round(target.getBoundingClientRect().top - container.getBoundingClientRect().top)
  }, text)

// Is the heading with this text attached to the DOM at all? Under viewport
// virtualization a block outside the rendered band is swapped for a
// `.mu-virtual-placeholder`, so its heading element does not exist — that is
// the precondition for the sparse-index bug this file now guards.
const isHeadingMounted = (page: Page, text: string): Promise<boolean> =>
  page.evaluate((needle) => {
    const sel =
      '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
    const normalize = (s: string) => s.replace(/^[#\s]+/, '').trim()
    return Array.from(document.querySelectorAll(sel)).some(
      (h) => normalize(h.textContent || '') === needle
    )
  }, text)

const showSidebar = async (app: ElectronApplication, page: Page): Promise<void> => {
  const visible = await page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return !!(el && el.offsetParent !== null)
  })
  if (!visible) {
    await clickMenuById(app, 'sideBarMenuItem')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )
  }
}

test.describe('TOC sidebar click scrolls the live editor', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(buildLongDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    // Open the sidebar and switch its right column to the ToC (el-tree).
    await showSidebar(app, page)
    await ensureTocVisible(app, page)
    // The TOC is seeded from `editor.getTOC()` on mount / json-change. Wait
    // until every heading has rendered a tree node before clicking.
    await page.waitForFunction(
      (count) => document.querySelectorAll('.side-bar-toc .el-tree-node__label').length >= count,
      HEADING_COUNT,
      { timeout: 10000 }
    )
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('clicking a deep outline entry scrolls the editor to that heading', async () => {
    const targetText = 'Heading Number 18'
    const targetIndex = await headingIndexByText(page, targetText)
    expect(targetIndex).toBeGreaterThanOrEqual(0)

    // Start near the top so the click must scroll DOWN to reveal heading 18.
    await page.evaluate(() => {
      const el = document.querySelector('.editor-component') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => getScrollTop(page)).toBe(0)
    expect(await isHeadingInViewport(page, targetText)).toBe(false)

    // Click the matching el-tree node label (the real user path: this fires the
    // `scroll-to-header` bus event with the heading's slug).
    const label = tocLabel(page, targetText)
    await label.click()

    // The scroll is animated (~300ms). Poll until it settles above 0.
    await expect.poll(() => getScrollTop(page), { timeout: 8000 }).toBeGreaterThan(0)
    // And the target heading must be in the viewport.
    await expect.poll(() => isHeadingInViewport(page, targetText), { timeout: 8000 }).toBe(true)
    // Landing position: 320px below the CONTAINER top (STANDAR_Y). Waiting for
    // the animation to SETTLE (not a single frame) matters here — a mid-flight
    // reading is still hundreds of pixels away. Measuring from the container is
    // what keeps this honest: the old window-relative math left the heading
    // ~64px high (the title bar + menu bar height).
    await expect
      .poll(
        async () => {
          const offset = await headingOffsetFromContainerTop(page, targetText)
          return Math.abs(offset - 320) <= 8
        },
        { timeout: 8000 }
      )
      .toBe(true)
  })

  test('clicking an earlier heading scrolls back up toward it', async () => {
    // Scrolls down here instead of reusing the position the test above left: a
    // CI retry re-runs a failed test alone against a fresh app from `beforeAll`,
    // where the editor starts at scrollTop 0 and `fromTop > 0` cannot hold.
    await tocLabel(page, 'Heading Number 18').click()
    // The resting position, not a frame of the animation: comparing the next
    // click against a mid-flight value is what made this fail alone.
    const fromTop = await settleScrollTop(page)

    const targetText = 'Heading Number 3'
    const targetIndex = await headingIndexByText(page, targetText)
    expect(targetIndex).toBeGreaterThanOrEqual(0)

    const label = tocLabel(page, targetText)
    await label.click()

    // Scrolling up to heading 3 must reduce scrollTop substantially.
    await expect.poll(() => getScrollTop(page), { timeout: 8000 }).toBeLessThan(fromTop)
    await expect.poll(() => isHeadingInViewport(page, targetText), { timeout: 8000 }).toBe(true)
  })

  test('clicking the same heading twice is idempotent (stays at that heading)', async () => {
    const targetText = 'Heading Number 12'
    const targetIndex = await headingIndexByText(page, targetText)
    expect(targetIndex).toBeGreaterThanOrEqual(0)

    const label = tocLabel(page, targetText)
    await label.click()
    await expect.poll(() => isHeadingInViewport(page, targetText), { timeout: 8000 }).toBe(true)
    const firstScroll = await getScrollTop(page)

    // Click again — should land on (essentially) the same scroll position.
    await label.click()
    await page.waitForTimeout(500)
    await expect.poll(() => isHeadingInViewport(page, targetText), { timeout: 8000 }).toBe(true)
    const secondScroll = await getScrollTop(page)
    expect(Math.abs(secondScroll - firstScroll)).toBeLessThanOrEqual(5)
  })

  // SB (PERF-04) regression: once the viewport is scrolled deep, blocks outside
  // the rendered band (2,000px margin) become `.mu-virtual-placeholder` slots,
  // so `.mu-container > hN` is a SPARSE subset of the outline. The old handler
  // indexed that sparse list (`headings[tocIndex]`) and silently scrolled to
  // whichever heading happened to be mounted — clicking an early entry from the
  // bottom of a long document jumped to a nearby section, not the target.
  test('clicking an early entry while scrolled deep lands on that heading', async () => {
    const targetText = 'Heading Number 2'
    // Park the view at the very bottom and let the virtualizer sweep. The sweep
    // is throttled AND suppressed for ~700ms after the previous test's
    // programmatic TOC scroll, so alternate between two bottom positions: each
    // REAL position change fires the scroll event the sweep needs (writing the
    // same clamped value does not). The test then waits for the precondition —
    // the target is no longer attached — instead of a fixed sleep.
    let nudge = 0
    await expect
      .poll(
        async () => {
          nudge = nudge === 0 ? 80 : 0
          await page.evaluate((offset) => {
            const el = document.querySelector('.editor-component') as HTMLElement | null
            if (el) el.scrollTop = el.scrollHeight - el.clientHeight - offset
          }, nudge)
          return isHeadingMounted(page, targetText)
        },
        { timeout: 15_000, intervals: [250, 400, 600] }
      )
      .toBe(false)

    const fromTop = await getScrollTop(page)
    expect(fromTop).toBeGreaterThan(0)

    await tocLabel(page, targetText).click()

    // Must travel back up AND actually reveal the requested heading; landing on
    // a mounted neighbour satisfies only the first half.
    await expect.poll(() => getScrollTop(page), { timeout: 8000 }).toBeLessThan(fromTop)
    await expect.poll(() => isHeadingInViewport(page, targetText), { timeout: 8000 }).toBe(true)
  })
})
