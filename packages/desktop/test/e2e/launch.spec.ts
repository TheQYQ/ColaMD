import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

test.describe('Check Launch ColaMD', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async () => {
    await app.close()
  })

  test('Empty ColaMD', async () => {
    const title = await page.title()
    expect(/^ColaMD|Untitled-1 - ColaMD$/.test(title)).toBeTruthy()
  })
})
