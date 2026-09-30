// Format ▸ Line ending (and the encoding / final-newline siblings) applied to a
// document with unsaved edits used to CLEAR the unsaved marker even though no
// write happens -- `store/editor.ts` set `currentFile.isSaved = true` in all three
// actions. The user then closed the tab without a prompt, and on the next launch
// main replaced the buffer with the on-disk text
// (`main/windows/editor.ts:641-646`), so the typed words were gone. Issue #26
// item 1; the store-level regression is `format-actions-dirty.spec.ts`.
//
// Two traps this spec has to avoid, both found by running it against the UNFIXED
// build:
//  - `SET_LINE_ENDING` early-returns when the value equals the tab's current one,
//    so a single menu click can be a no-op and the spec passes for the wrong
//    reason (that is exactly what the first draft did -- 2/2 green on develop).
//    Hence the alternating sends below: whatever the starting ending is, at least
//    two of the three are real transitions.
//  - The menu item is the honest entry point, but `clickMenuById` on a radio entry
//    only reaches the store through the same channel the menu sends
//    (`mt::set-line-ending`, `src/shared/types/ipc.ts:380`), so the spec drives
//    that channel directly -- which is also what `typedSend` does
//    (`src/main/menu/actions/edit.ts:132`).
//  - The encoding and final-newline siblings are NOT driven here on purpose: they
//    are renderer-internal bus events emitted only by palette subcommand flows
//    (`commands/fileEncoding.ts:77`, `commands/trailingNewline.ts:71`), so there is
//    no single entry point to drive. They are covered at store level in
//    `format-actions-dirty.spec.ts`, and the three actions share the one line that
//    was removed.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  markAllTabsClean,
  sendIpcToRenderer,
  typeIntoEditor,
  waitForEditor,
  closeApp
} from './helpers'

const TAB = '.editor-tabs li[data-id]'

test.describe('Format actions keep the unsaved marker', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('# Line ending and dirty state\n\nbody\n')
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    // Start clean so the only thing that can mark the tab dirty is the typing
    // below; a freshly opened file may already be flagged by the load-time
    // auto-normalize path, which would hide the assertion.
    await markAllTabsClean(app, page)
    await expect(page.locator(`${TAB}.unsaved`)).toHaveCount(0)

    await typeIntoEditor(page, ' typed-words-that-must-survive')
    await expect(page.locator(`${TAB}.unsaved`)).toHaveCount(1)
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('every line-ending transition keeps the tab unsaved', async () => {
    for (const ending of ['crlf', 'lf', 'crlf'] as const) {
      await sendIpcToRenderer(app, 'mt::set-line-ending', ending)
      await expect
        .poll(() => page.locator(`${TAB}.unsaved`).count(), {
          timeout: 5000,
          message: `after switching the line ending to ${ending}`
        })
        .toBe(1)
    }
  })

  test('the typed text is still the live document', async () => {
    await expect(page.locator('.editor-component')).toContainText('typed-words-that-must-survive')
  })
})
