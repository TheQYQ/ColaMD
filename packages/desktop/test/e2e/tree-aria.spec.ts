import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, launchElectron } from './helpers'

// A11Y-06 / GUI-SC2. The tree already had keyboard navigation code, but the
// rows exposed their identity only through data-* attributes and CSS classes,
// so a screen reader saw an unlabelled list of divs. This spec pins the
// semantics itself: one `tree` tab stop with the virtual focus in
// `aria-activedescendant`, `treeitem` rows with `aria-level`, folders with
// `aria-expanded` and a `group` of children, and the open document marked with
// `aria-current`.
//
// It also pins the DOM glue that feeds those attributes: the reducer reads the
// row identity, and until now the rows never emitted the attribute the glue
// looked for, so keyboard focus never landed on a real row.
//
// The launch opens the desktop package folder as the project root (the e2e
// helper passes it as the app path), so the fixture is the real tree:
// `static/` → `welcome/` → `welcome.md` gives one folder per level plus a
// markdown file to open.

test.describe('Sidebar file tree ARIA semantics (A11Y-06)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchElectron()
    app = launched.app
    page = launched.page
    await page.waitForSelector('.tree-wrapper[role="tree"]', { timeout: 15000 })
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('exposes one tree named after the project, with levelled treeitems', async () => {
    const tree = page.getByRole('tree')
    await expect(tree).toHaveCount(1)
    await expect(tree).toHaveAttribute('aria-label', 'desktop')

    const staticRow = tree.getByRole('treeitem', { name: 'static' })
    await expect(staticRow).toHaveAttribute('aria-level', '1')
    await expect(staticRow).toHaveAttribute('aria-expanded', 'false')
  })

  test('folders report their state, own a group, and nest levels correctly', async () => {
    const tree = page.getByRole('tree')
    const staticRow = tree.getByRole('treeitem', { name: 'static' })
    await expect(staticRow.locator('[role="group"]')).toHaveCount(0)

    await staticRow.locator('.folder-name').click()

    await expect(staticRow).toHaveAttribute('aria-expanded', 'true')
    await expect(staticRow.locator('[role="group"]')).toHaveCount(1)

    const welcome = staticRow.getByRole('treeitem', { name: 'welcome', exact: true })
    await expect(welcome).toHaveAttribute('aria-level', '2')
    await welcome.locator('.folder-name').click()

    await expect(welcome).toHaveAttribute('aria-expanded', 'true')
    const welcomeMd = welcome.getByRole('treeitem', { name: 'welcome.md' })
    await expect(welcomeMd).toHaveAttribute('aria-level', '3')
    // A file row must not pretend to be expandable.
    await expect(welcomeMd).not.toHaveAttribute('aria-expanded')
  })

  test('keyboard focus is announced through aria-activedescendant and aria-selected', async () => {
    const tree = page.getByRole('tree')
    const rows = tree.getByRole('treeitem')
    const firstId = await rows.first().getAttribute('id')
    const secondId = await rows.nth(1).getAttribute('id')

    await page.locator('.tree-wrapper').focus()
    await page.keyboard.press('Home')
    await expect(tree).toHaveAttribute('aria-activedescendant', firstId ?? '')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(tree).toHaveAttribute('aria-activedescendant', secondId ?? '')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'false')
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  })

  test('the document open in the editor is marked aria-current', async () => {
    const tree = page.getByRole('tree')
    const staticRow = tree.getByRole('treeitem', { name: 'static' })
    if ((await staticRow.getAttribute('aria-expanded')) === 'false') {
      await staticRow.locator('.folder-name').click()
    }

    const welcome = staticRow.getByRole('treeitem', { name: 'welcome', exact: true })
    if ((await welcome.getAttribute('aria-expanded')) === 'false') {
      await welcome.locator('.folder-name').click()
    }

    const welcomeMd = welcome.getByRole('treeitem', { name: 'welcome.md' })
    await expect(welcomeMd).not.toHaveAttribute('aria-current')

    await welcomeMd.click()

    await expect(welcomeMd).toHaveAttribute('aria-current', 'true')
  })
})
