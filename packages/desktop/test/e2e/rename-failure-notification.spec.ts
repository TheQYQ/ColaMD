import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchWithMarkdown, waitForEditor } from './helpers'

// mt::rename / mt::move-file used to log a main-process error and return when
// fsRename failed, leaving the tab state silently diverged from disk. The fix
// surfaces the failure to the user via the existing mt::show-notification
// channel (notification.ts listens on it and renders .mt-notification).
//
// This spec drives the rename channel end-to-end: a source path that does not
// exist makes fsRename fail with ENOENT on every platform, no native dialog is
// involved (unlike mt::move-file, whose identical notification branch sits
// behind a save dialog).

test.describe('Rename failure surfaces an error notification', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Rename failure\n')
    app = launched.app
    page = launched.page
    await waitForEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('a failed rename shows a Rename failed notification', async() => {
    const missingSource = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'colamd-e2e-rename-')),
      'ghost.md'
    )
    // Both paths are absent and distinct, so the handler skips its
    // file-exists dialog and fsRename fails straight away with ENOENT.
    const target = path.join(os.tmpdir(), 'colamd-e2e-rename-target.md')

    await page.evaluate(
      ({ src, dest }) =>
        window.electron.ipcRenderer.send('mt::rename', {
          id: 'rename-failure-test',
          pathname: src,
          newPathname: dest
        }),
      { src: missingSource, dest: target }
    )

    const notice = page.locator('.mt-notification')
    await expect(notice).toBeVisible({ timeout: 10000 })
    await expect(notice.locator('.title span')).toHaveText('Rename failure')
    // The body carries the OS error message (e.g. ENOENT), not an empty shell.
    await expect(notice.locator('.body .left-text')).not.toBeEmpty()

    fs.rmSync(path.dirname(missingSource), { recursive: true, force: true })
  })
})
