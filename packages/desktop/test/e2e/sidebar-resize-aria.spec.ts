import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, launchElectron } from './helpers'

// A11Y-12 / GUI-SC4. The sidebar width could only be changed by dragging the
// 3 px strip with a mouse. It is now a focusable WAI-ARIA window splitter:
// `role="separator"` with a range and a localised name, ArrowLeft/ArrowRight
// stepping (Shift = large step), and a `color-scheme` declaration so native
// chrome follows the theme. Labels are locale-dependent (the app follows the
// OS language), so assertions never match translated text.

const sideBarWidth = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    if (!el) throw new Error('no sidebar in the DOM')
    return parseInt(el.style.width, 10)
  })

test.describe('Sidebar resize strip ARIA + keyboard (A11Y-12)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchElectron()
    app = launched.app
    page = launched.page
    await page.waitForSelector('.side-bar [role="separator"]', { timeout: 15000 })
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('the drag strip is a focusable vertical separator with a range', async () => {
    const separator = page.locator('.side-bar [role="separator"]')
    await expect(separator).toHaveCount(1)
    await expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    await expect(separator).toHaveAttribute('tabindex', '0')
    // Non-empty, but which language it is depends on the OS locale.
    await expect(separator).toHaveAttribute('aria-label', /^\S+$/)
    await expect(separator).toHaveAttribute('aria-valuemin', '220')

    const width = await sideBarWidth(page)
    await expect(separator).toHaveAttribute('aria-valuenow', String(width))
    const max = Number(await separator.getAttribute('aria-valuemax'))
    expect(max).toBeGreaterThanOrEqual(width)
  })

  test('ArrowRight/ArrowLeft resize by a step and persist the width', async () => {
    const separator = page.locator('.side-bar [role="separator"]')
    await separator.focus()
    const before = await sideBarWidth(page)

    await page.keyboard.press('ArrowRight')
    await expect.poll(() => sideBarWidth(page)).toBe(before + 16)
    await expect(separator).toHaveAttribute('aria-valuenow', String(before + 16))
    expect(await page.evaluate(() => localStorage.getItem('side-bar-width'))).toBe(
      String(before + 16)
    )

    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => sideBarWidth(page)).toBe(before)

    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    await expect.poll(() => sideBarWidth(page)).toBe(before + 64)
  })

  test('declares the native colour scheme for Chromium chrome', async () => {
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
    expect(['light', 'dark']).toContain(scheme)
    const bodyScheme = await page.evaluate(() => getComputedStyle(document.body).colorScheme)
    expect(['light', 'dark']).toContain(bodyScheme)
  })
})
