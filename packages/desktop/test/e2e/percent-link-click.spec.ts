// #27 item 1, end to end: a markdown link whose target contains a literal `%`
// (`100%done.md`) used to throw URIError inside the `mt::format-link-click`
// handler, because the handler ran `decodeURIComponent` on the joined path with no
// guard and `typedOn` adds no try/catch. The user saw a main-process error dialog
// (or nothing at all, when the dialog is suppressed) and the link did not open.
//
// This drives the real channel the renderer uses, with two files in one directory
// so the relative link resolves: `doc.md` is opened at launch, and the click must
// bring up `100%done.md` as a second tab.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, waitForEditor, closeApp } from './helpers'

const TAB = '.editor-tabs li[data-id]'

test.describe('Clicking a link whose target contains a literal percent', () => {
  let app: ElectronApplication
  let page: Page
  let dir: string
  let docPath: string

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colamd-e2etest-percentlink-'))
    docPath = path.join(dir, 'doc.md')
    fs.writeFileSync(path.join(dir, '100%done.md'), '# Target with a percent\n', 'utf-8')
    fs.writeFileSync(docPath, '# Doc\n\n[open it](100%done.md)\n', 'utf-8')

    const launched = await launchElectron([docPath], { suppressErrorDialog: true })
    app = launched.app
    page = launched.page
    await waitForEditor(page)
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  test('the document opens as a second tab', async () => {
    await expect(page.locator(TAB)).toHaveCount(1)

    await page.evaluate(
      ({ href, dirname }) =>
        window.electron.ipcRenderer.send('mt::format-link-click', {
          data: { href },
          dirname
        }),
      { href: '100%done.md', dirname: dir }
    )

    await expect(page.locator(TAB)).toHaveCount(2, { timeout: 10000 })
    const titles = (await page.locator(`${TAB} span`).allInnerTexts()).map((t) => t.trim())
    expect(titles).toContain('100%done.md')
  })

  test('an ordinary relative link still opens', async () => {
    // Counts the delta, not an absolute tab count: the tab opened by the test
    // above is not a precondition this case may inherit (a CI retry re-runs a
    // failed test alone against a fresh app from `beforeAll`, so an absolute
    // count here could only ever fail).
    fs.writeFileSync(path.join(dir, 'plain.md'), '# Plain\n', 'utf-8')
    const before = await page.locator(TAB).count()

    await page.evaluate(
      ({ href, dirname }) =>
        window.electron.ipcRenderer.send('mt::format-link-click', {
          data: { href },
          dirname
        }),
      { href: 'plain.md', dirname: dir }
    )

    await expect(page.locator(TAB)).toHaveCount(before + 1, { timeout: 10000 })
    const titles = (await page.locator(`${TAB} span`).allInnerTexts()).map((t) => t.trim())
    expect(titles).toContain('plain.md')
  })
})
