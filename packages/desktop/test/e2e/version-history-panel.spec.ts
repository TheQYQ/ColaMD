import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, placeCaretInEditor, sendIpcToRenderer, closeApp } from './helpers'

// The version-history panel end to end: real saves create snapshots, the
// sidebar panel lists them, and restoring puts an older body back into the
// editor. Chain under test:
//   save (mt::editor-ask-file-save -> store FILE_SAVE) -> SAVE_VERSION_SNAPSHOT
//   -> mt::version-history:save -> main VersionHistoryStore
//   panel list -> mt::version-history:list (metadata only)
//   restore -> mt::version-history:get-content -> window CustomEvent
//   -> store LISTEN_FOR_VERSION_RESTORE -> bus file-changed -> muya re-render
//
// Driven through the same IPC channel the File > Save menu item sends, like
// all-blocks-roundtrip.spec.ts does.

const save = async (app: ElectronApplication, page: Page): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  // When the tab was dirty the unsaved dot clears only after the real
  // main-process write; when it was already clean this resolves immediately.
  await expect
    .poll(() => page.evaluate(() => !document.querySelector('.editor-tabs li.unsaved')), {
      timeout: 10_000
    })
    .toBe(true)
}

const editorText = (page: Page): Promise<string> =>
  page.evaluate(() => (document.querySelector('.editor-component')?.textContent ?? '').trim())

test.describe('version history panel', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('# v1\n')
    app = launched.app
    page = launched.page
  })

  test('lists snapshots and restores an older version', async () => {
    await save(app, page)

    // Snapshot 1 may still be in flight, so read the count from the panel: the
    // list reloads when the store announces the snapshot on the bus.
    await page.locator('.side-bar .side-bar-tab').nth(2).click()
    await expect(page.locator('.side-bar-history')).toBeVisible()
    await expect(page.locator('.side-bar-history .snapshot-item')).toHaveCount(1, {
      timeout: 10_000
    })

    // Snapshot 2: extend the heading, then save through the same channel.
    await page.locator('.side-bar .side-bar-tab').nth(0).click()
    await placeCaretInEditor(page)
    await page.keyboard.press('End')
    await page.keyboard.type(' v2', { delay: 10 })
    await save(app, page)

    await page.locator('.side-bar .side-bar-tab').nth(2).click()
    const panel = page.locator('.side-bar-history')
    // The list is newest-first, so both saves are visible and the second one
    // sits on top.
    await expect(panel.locator('.snapshot-item')).toHaveCount(2, { timeout: 10_000 })
    await expect(panel.locator('.snapshot-item').first()).toContainText('Manual Save')

    // Restore the oldest snapshot (last in the list) via its Restore action
    // and confirm the ElMessageBox.
    await panel.locator('.snapshot-item').last().locator('.snapshot-actions button').first().click()
    await page.locator('.el-message-box__btns .el-button--primary').click()

    // The editor re-renders the restored body; 'v2' must be gone.
    await expect.poll(() => editorText(page), { timeout: 10_000 }).toContain('v1')
    await expect.poll(() => editorText(page), { timeout: 10_000 }).not.toContain('v2')
  })

  test.afterAll(async () => {
    if (app) {
      await closeApp(app)
    }
  })
})
