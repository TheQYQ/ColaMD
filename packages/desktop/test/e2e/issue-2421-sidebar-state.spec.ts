import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById, markAllTabsClean } from './helpers'

// #2421 — toggling the sidebar must not lose state.
// Two bugs (fixed against the old icon-strip sidebar, re-locked here against
// the Typora-style tab sidebar): (1) collapsing persisted the clamped 220px
// width instead of the real width, so re-expanding shrank the sidebar;
// (2) the tree's collapsed sections reset when the sidebar was toggled.
// Toggle mechanism now: clicking the active text tab closes the sidebar
// (`v-show`), clicking a tab re-opens it. These drive the real built app.

const filesTab = (page: Page) =>
  page.locator('.side-bar .side-bar-tab').first()

const sideBarWidth = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().width) : 0
  })

const sideBarVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return !!(el && el.offsetParent !== null)
  })

test.describe('#2421 sidebar state survives toggle', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Doc\n\n## A\n\n## B\n')
    app = launched.app
    page = launched.page
    // A file open starts with the sidebar visible on the default 'files'
    // panel (only the TOC auto-show was removed). Proceed directly; the
    // files tab is active, so its click takes the close branch below.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )
  })

  test.afterAll(async() => {
    if (app) {
      await markAllTabsClean(app, page)
      await app.close()
    }
  })

  test('collapsing then re-expanding preserves a widened sidebar width', async() => {
    // Widen the sidebar past the 220px minimum by dragging the drag-bar, so a
    // width loss on collapse is observable (the default already sits at 220).
    const dragBar = page.locator('.side-bar .drag-bar')
    const box = await dragBar.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 80)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + 80, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!el && el.getBoundingClientRect().width >= 300
      },
      null,
      { timeout: 5000 }
    )

    const widened = await sideBarWidth(page)
    expect(widened).toBeGreaterThanOrEqual(300)

    await filesTab(page).click() // collapse (active tab click closes)
    await expect.poll(sideBarVisible.bind(null, page)).toBe(false)

    // The tab row is inside the hidden sidebar — re-open via the View menu.
    await clickMenuById(app, 'sideBarMenuItem')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )

    const reExpanded = await sideBarWidth(page)
    // The widened width must survive the collapse round-trip (it was reset to
    // the clamped 220px before the fix).
    expect(Math.abs(reExpanded - widened)).toBeLessThanOrEqual(3)
  })

  test('a collapsed tree section stays collapsed after toggling the sidebar', async() => {
    const arrow = page.locator('.side-bar .opened-files > .title .icon-arrow').first()
    await expect(arrow).toBeVisible()

    // Collapse the "Opened files" section.
    await arrow.click()
    await page.waitForFunction(
      () => {
        const a = document.querySelector('.side-bar .opened-files .icon-arrow')
        return !!(a && a.classList.contains('fold'))
      },
      null,
      { timeout: 5000 }
    )

    // Toggle the whole sidebar off (active tab click) and back on (View menu).
    await filesTab(page).click()
    await expect.poll(sideBarVisible.bind(null, page)).toBe(false)
    await clickMenuById(app, 'sideBarMenuItem')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar .opened-files') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )

    const stillCollapsed = await page.evaluate(() => {
      const a = document.querySelector('.side-bar .opened-files .icon-arrow')
      return !!(a && a.classList.contains('fold'))
    })
    expect(stillCollapsed).toBe(true)
  })
})
