// Quick-open turns the query into a RegExp with no guard and no cost bound
// (commands/quickOpen.ts:125). Measured on this branch's own temp path (69
// chars), a run of 6 `*` costs 12.6 s for the ONE tab that is open, because `*`
// maps to `.*` and consecutive `.*` groups backtrack exponentially against a
// non-matching tail. The scan runs on the renderer main thread, so during that
// window the palette accepts no keystroke.
//
// Two things this spec has to keep honest:
//  - The palette calls `updateCommands()` from `@keyup`
//    (components/commandPalette/index.vue:21,230), NOT from `input`. A
//    `locator.fill()` dispatches no keyup and therefore starts no search at
//    all, so everything here is typed one key press at a time
//    (`locator.pressSequentially`; the Keyboard object only has `type`).
//  - A call that is blocked by a busy main thread simply returns late, so
//    asserting "the text got echoed" cannot fail. The only assertion that can
//    fail is the elapsed time of a round trip issued while the scan runs.
//  - `mt::show-command-palette` is the WRONG entry point here: it opens the root
//    palette (the command list), whose search never compiles a RegExp. See
//    `openQuickOpen` below.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const INPUT = '.search-wrapper input.search, input.search'
const RESULTS = 'ul.commands .title'

// 6 stars measured at ~12.6 s on a 69-char path; collapsing the run makes it
// cost what one star costs. The bound sits between the two.
const PATHOLOGICAL = '******zzz'
const STALL_BUDGET_MS = 3000

// `mt::show-command-palette` opens the ROOT palette (the command list), whose
// search is a substring filter and never compiles a RegExp. Quick-open is the
// command behind Ctrl+P: main dispatches `mt::execute-command-by-id` with the
// command id (src/main/commands/file.ts:6-8, keybindingsWindows.ts:122), so the
// test enters through that same channel. `typedSend` adds no runtime envelope,
// it is compile-time typing only (src/main/ipc/typedSend.ts:21).
const openQuickOpen = async (app: ElectronApplication, page: Page): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::execute-command-by-id', 'file.quick-open')
  await expect(page.locator(INPUT).first()).toBeVisible({ timeout: 5000 })
  await page.locator(INPUT).first().click()
}

const typeQuery = async (page: Page, text: string): Promise<void> => {
  await page.locator(INPUT).first().pressSequentially(text)
}

const closePalette = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape')
  await expect(page.locator(INPUT).first()).toBeHidden({ timeout: 5000 })
}

const expectOpenDocumentListed = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.locator(RESULTS).allInnerTexts(), { timeout: 8000 })
    .toContainEqual(expect.stringContaining('note.md'))
}

test.describe('Quick-open pattern safety', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('# Quick open\n\nSome content.\n', {
      suppressErrorDialog: true
    })
    app = launched.app
    page = launched.page
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('typing a query lists the open document', async () => {
    await openQuickOpen(app, page)
    await typeQuery(page, 'note')
    await expectOpenDocumentListed(page)
    await closePalette(page)
  })

  test('a nested-quantifier glob does not hold the renderer main thread hostage', async () => {
    await openQuickOpen(app, page)
    await typeQuery(page, PATHOLOGICAL)

    // The query is debounced by 300 ms (commands/quickOpen.ts:65-71); wait past
    // it so the round trip below is issued while the scan is running.
    await page.waitForTimeout(500)
    const started = Date.now()
    await page.evaluate(() => true)
    const blockedMs = Date.now() - started

    await expectNoRendererErrors(app)
    expect(blockedMs).toBeLessThan(STALL_BUDGET_MS)

    // And the palette is still usable right afterwards.
    await closePalette(page)
    await openQuickOpen(app, page)
    await typeQuery(page, 'note')
    await expectOpenDocumentListed(page)
    await closePalette(page)
  })
})
