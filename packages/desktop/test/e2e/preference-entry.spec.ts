import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { clickMenuById, launchElectron, waitForMenuReady } from './helpers'

// The preferences entry used to be verified only by a person clicking it once,
// which leaves nothing to re-check. Two things are worth pinning: the menu item
// really produces a rendered settings window (not just a window that exists),
// and it stays a single window — the second use focuses the first and routes it
// (src/main/app/index.ts:687), it does not stack another one.
//
// The entry is addressed by the id `preferencesMenuItem` (file.ts:124), which is
// why the item carries one. On macOS the File-menu entry is the hidden twin of
// the app-menu one, so the click is programmatic there; the handler is the same.

const prefPages = (app: ElectronApplication): Page[] =>
  app.windows().filter((w) => w.url().includes('/preference'))

/** What the Preferences menu item does when it is clicked. */
const requestSettingsWindow = async (
  app: ElectronApplication,
  category?: string
): Promise<void> => {
  await app.evaluate(({ ipcMain }, cat) => {
    ipcMain.emit('app-create-settings-window', cat)
  }, category)
}

test.describe('the Preferences entry', () => {
  let app: ElectronApplication

  test.beforeAll(async () => {
    app = (await launchElectron()).app
    await waitForMenuReady(app)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('opens a rendered settings window', async () => {
    expect(prefPages(app)).toHaveLength(0)

    await clickMenuById(app, 'preferencesMenuItem')

    await expect.poll(async () => prefPages(app).length, { timeout: 15_000 }).toBe(1)
    const pref = prefPages(app)[0]
    await pref.waitForSelector('.pref-container .pref-setting', {
      state: 'visible',
      timeout: 15_000
    })
    // The panel lists its categories; a window that opened but failed to mount
    // the page would have the container and none of these.
    expect(await pref.locator('.pref-sidebar .item').count()).toBeGreaterThan(3)
  })

  test('reuses that window instead of opening a second one', async () => {
    // Asked again, the entry goes through the same internal channel the menu
    // item clicks (`actions/colamd.ts:74`). The menu itself is not reachable
    // from here any more: on Windows the application menu belongs to the editor
    // window, and the settings window that now has focus carries none.
    await requestSettingsWindow(app)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    expect(prefPages(app)).toHaveLength(1)
  })

  test('routes to the panel a caller asks for', async () => {
    // The spellchecker context menu asks for the Spelling panel by category
    // (src/main/contextMenu/editor/spellcheck.ts:79), so the entry has to honour
    // it for a window that is already open. Asserted on the route, not on the
    // label: labels are translated.
    const pref = prefPages(app)[0]
    await requestSettingsWindow(app, 'spelling')

    await expect.poll(() => pref.url(), { timeout: 10_000 }).toContain('/preference/spelling')
    expect(prefPages(app)).toHaveLength(1)
  })
})
