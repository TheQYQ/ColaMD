import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { focusEditor, launchWithMarkdown, sendIpcToRenderer, closeApp } from './helpers'

const SEARCH_BAR = '.search-bar'
const FIND_INPUT = '.search-bar .search input'
const REGEX_TOGGLE = '.search-bar .is-regex'
const ERROR_MSG = '.search-bar .error-msg'
const RESULT_COUNTER = '.search-bar .search-result'

// 40 of one repeated letter makes `(a+)+b` catastrophic: the engine tries every
// partition of the run before failing, so a single exec never returns.
const A_RUN = 'a'.repeat(40)

const counterText = (p: Page): Promise<string> => p.locator(RESULT_COUNTER).innerText()

test.describe('Search regex ReDoS guard', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(`# ReDoS guard\n\napple apricot\n\n${A_RUN}\n`)
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  // Opening Find prefills the query from the editor selection, which would run
  // a real search before the test's own query, so clear it and pin the baseline
  // at "no matches". Regex mode is shared state across tests: turn it on here
  // rather than assuming the previous test left it that way.
  const resetBar = async (): Promise<void> => {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await expect(page.locator(SEARCH_BAR)).toBeVisible({ timeout: 5000 })
    await page.locator(FIND_INPUT).fill('')
    await expect.poll(() => counterText(page)).toBe('0 / 0')
    const toggle = page.locator(REGEX_TOGGLE)
    if (!(await toggle.evaluate((el) => el.classList.contains('active')))) {
      await toggle.click()
    }
    await expect(toggle).toHaveClass(/active/)
    await expect.poll(() => counterText(page)).toBe('0 / 0')
  }

  test('a catastrophic pattern is refused with a timeout message, not a frozen window', async () => {
    await resetBar()
    await page.locator(FIND_INPUT).fill('(a+)+b')

    // The probe never answers (one exec that does not return), so the main
    // thread's watchdog terminates the worker and the search is refused. Fresh
    // temp profiles follow the system language, so accept either locale.
    await expect(page.locator(ERROR_MSG)).toContainText(/(Regex timed out|正则执行超时)/, {
      timeout: 15000
    })
    await expect.poll(() => counterText(page)).toBe('0 / 0')
    await expect(page.locator('.mu-highlight')).toHaveCount(0)
  })

  test('a query typed while a probe is hung is searched normally', async () => {
    await resetBar()
    await page.locator(FIND_INPUT).fill('(a+)+b')
    // Let the first probe actually start (the watcher debounces by 150 ms), then
    // replace the query while that worker is still stuck inside one exec. The
    // new request has to take the worker over: queuing behind the hung exec
    // would have it refused by the watchdog too.
    await page.waitForTimeout(600)
    await page.locator(FIND_INPUT).fill('ap')

    await expect.poll(() => counterText(page), { timeout: 15000 }).toContain('/ 2')
    await expect(page.locator(ERROR_MSG)).toHaveCount(0)
    await expect(page.locator('.mu-highlight')).toHaveCount(1)
  })
})
