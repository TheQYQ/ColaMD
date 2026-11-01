import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { basename, resolve } from 'node:path'
import { launchElectron, closeApp } from './helpers'

test.describe('Check Launch ColaMD', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async () => {
    await closeApp(app)
  })

  test('Empty ColaMD', async () => {
    const title = await page.title()
    // launchElectron passes the project root as the entry, so the app opens
    // `packages/desktop` as the working folder. With a folder open and no
    // file, the window title is the folder's basename (VS Code-style); with
    // nothing open at all it falls back to the brand default from
    // index.html. The old expectation (`Untitled-1 - ColaMD`) pinned the
    // accident that the title watch never fired when only the project was
    // known — it started tracking the project in GUI-B1 (UX-01).
    const openedFolder = basename(resolve(__dirname, '../..'))
    expect(title === 'ColaMD' || title === openedFolder).toBeTruthy()
  })
})
