import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, launchWithMarkdown } from './helpers'

// GUI-SC1 (A11Y-04 / UX-09). Before this batch the in-window menu bar was
// mouse-only in the strict sense: `.menu-bar` children were plain divs with
// `@click` and no tabindex, so nothing could open a dropdown from the keyboard
// at all. macOS renders the native menu instead (`titleBarStyle === 'custom'
// && !isOsx`), so this whole file is Windows/Linux only.

// `buildMenus` fixes the top-level order (file, edit, paragraph, format, view,
// theme, help), so a position is the locale-independent way to name a menu.
const VIEW = 4
const EDIT = 1

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

  test('ArrowDown and ArrowUp walk the rows of the open menu', async () => {
    const bar = page.getByRole('menubar')
    const edit = bar.getByRole('menuitem').nth(1)
    await edit.focus()
    await edit.press('Enter')

    const dropdown = page.getByRole('menu').first()
    await expect(dropdown).toBeVisible()

    const labels = await dropdown.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('[role^="menuitem"]')).map(
        (row) => row.textContent ?? ''
      )
    )
    expect(labels.length).toBeGreaterThan(2)

    const active = (): Promise<string> =>
      dropdown.evaluate(() => document.activeElement?.textContent ?? '')

    expect(await active()).toBe(labels[0])
    await page.keyboard.press('ArrowDown')
    expect(await active()).toBe(labels[1])
    await page.keyboard.press('ArrowDown')
    expect(await active()).toBe(labels[2])
    await page.keyboard.press('ArrowUp')
    expect(await active()).toBe(labels[1])
  })

  test('Enter on a focused row runs its command and closes the menu', async () => {
    // The dispatch path of the in-window bar had no coverage at all: the specs
    // that use `clickMenuById` drive Electron's NATIVE menu through the main
    // process, which is a different object from these renderer-side items.
    //
    // Located positionally and by `aria-checked`, never by label: the app
    // resolves its locale from the OS, so this suite runs in Chinese on this
    // machine and English on CI — a name-based assertion would pass in one and
    // silently fail in the other.
    const view = page.getByRole('menubar').getByRole('menuitem').nth(VIEW)
    await view.focus()
    await view.press('Enter')

    const checkRow = page.getByRole('menu').first().getByRole('menuitemcheckbox').first()
    await expect(checkRow).toBeVisible()
    const before = await checkRow.getAttribute('aria-checked')

    await checkRow.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)

    // Reopen and read the same position: the state the command was supposed to
    // flip really flipped, so "the menu closed" is not the whole story.
    await view.focus()
    await view.press('Enter')
    const again = page.getByRole('menu').first().getByRole('menuitemcheckbox').first()
    await expect(again).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
    await page.keyboard.press('Escape')
  })

  test('Escape closes the menu and hands focus back to the top-level item', async () => {
    const view = page.getByRole('menubar').getByRole('menuitem').nth(VIEW)
    await view.focus()
    await view.press('Enter')
    await expect(page.getByRole('menu').first()).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(view).toHaveAttribute('aria-expanded', 'false')
    // Without the hand-back the user is dropped at the top of the document and
    // has to tab through the whole window to reach the bar again.
    //
    // #153: this read failed on linux CI in both the first attempt and the
    // retry. The hand-back is scheduled after Vue's DOM update, so a one-shot
    // read can land before the focus has moved back; poll instead of racing it.
    await expect
      .poll(() => view.evaluate((el) => el === document.activeElement), { timeout: 5000 })
      .toBe(true)
  })

  test('Home and End jump to the ends of the open menu', async () => {
    const view = page.getByRole('menubar').getByRole('menuitem').nth(VIEW)
    await view.focus()
    await view.press('Enter')
    const dropdown = page.getByRole('menu').first()
    await expect(dropdown).toBeVisible()

    const labels = await dropdown.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('[role^="menuitem"]')).map(
        (row) => row.textContent ?? ''
      )
    )
    const active = (): Promise<string> =>
      dropdown.evaluate(() => document.activeElement?.textContent ?? '')

    await page.keyboard.press('End')
    expect(await active()).toBe(labels[labels.length - 1])
    await page.keyboard.press('Home')
    expect(await active()).toBe(labels[0])
    await page.keyboard.press('Escape')
  })

  test('Arrow keys move the bar itself while no menu is open', async () => {
    // The existing left/right handling only ran with a menu open, so the bar
    // could not be traversed until you had already opened something by mouse.
    const items = page.getByRole('menubar').getByRole('menuitem')
    await items.first().focus()
    await page.keyboard.press('ArrowRight')

    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    expect(focusedText).not.toBe('')
    expect(await items.first().evaluate((el) => el === document.activeElement)).toBe(false)
    expect(await page.getByRole('menu').count()).toBe(0)
  })

  test('ArrowRight enters a submenu and ArrowLeft comes back out', async () => {
    // Line Ending sits under Edit as a flyout, which is the shape every
    // submenu in this bar has. Located by its ARIA, not by a label.
    const edit = page.getByRole('menubar').getByRole('menuitem').nth(EDIT)
    await edit.focus()
    await edit.press('Enter')

    const parent = page.getByRole('menu').first()
    const row = parent.locator('[aria-haspopup="menu"]').first()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'false')

    await row.focus()
    await page.keyboard.press('ArrowRight')

    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const submenu = parent.locator('> .submenu [role="menu"]')
    await expect(submenu).toBeVisible()
    // The point of the test: opening the flyout is worthless if the caret stays
    // on the row that spawned it.
    expect(await submenu.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('ArrowLeft')
    expect(await row.evaluate((el) => el === document.activeElement)).toBe(true)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Escape')
  })
})
