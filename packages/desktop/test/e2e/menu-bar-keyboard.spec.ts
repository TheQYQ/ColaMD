import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, launchWithMarkdown } from './helpers'

// GUI-SC1 (A11Y-04 / UX-09). Before this batch the in-window menu bar was
// mouse-only in the strict sense: `.menu-bar` children were plain divs with
// `@click` and no tabindex, so nothing could open a dropdown from the keyboard
// at all. macOS renders the native menu instead (`titleBarStyle === 'custom'
// && !isOsx`), so this whole file is Windows/Linux only.

test.describe('In-window menu bar keyboard access (GUI-SC1)', () => {
  test.skip(process.platform === 'darwin', 'the custom menu bar is not rendered on macOS')

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('# Menu keyboard\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('exposes a menubar of menuitems with exactly one tab stop', async () => {
    const bar = page.getByRole('menubar')
    await expect(bar).toBeVisible()

    const items = bar.getByRole('menuitem')
    expect(await items.count()).toBeGreaterThan(2)

    // Roving tabindex: the whole bar is ONE stop in the Tab order and the arrow
    // keys move inside it. Every item focusable would make users tab through
    // File/Edit/View/... to reach the editor.
    const inTabOrder = await items.evaluateAll((els) =>
      els.filter((el) => el.getAttribute('tabindex') === '0')
    )
    expect(inTabOrder).toHaveLength(1)
  })

  test('Enter on a focused top-level item opens its menu and moves focus into it', async () => {
    // Index 1 is Edit — anything but File, whose open awaits the recent-documents
    // fetch and would make the assertion about timing rather than about focus.
    const second = page.getByRole('menubar').getByRole('menuitem').nth(1)
    await second.focus()
    await second.press('Enter')

    await expect(second).toHaveAttribute('aria-expanded', 'true')
    const dropdown = page.getByRole('menu').first()
    await expect(dropdown).toBeVisible()

    // The dropdown is teleported to <body>; if focus stayed on the bar, a
    // screen reader would announce nothing when the menu "opens".
    const focusedInside = await dropdown.evaluate((el) => el.contains(document.activeElement))
    expect(focusedInside).toBe(true)
  })
})
