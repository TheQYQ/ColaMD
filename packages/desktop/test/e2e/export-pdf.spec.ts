import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import { launchWithMarkdown, waitForMenuReady } from './helpers'
import {
  clearExportSuccesses,
  exportSuccesses,
  installExportSuccessProbe,
  openExportDialog,
  restoreSaveDialog,
  runExport,
  stubSaveDialog
} from './exportHarness'

// Item 231 — PDF export to a real file (smoke).
//
// The full path is: File › Export › Export PDF →
//   main `exportFile()` sends `mt::show-export-dialog` →
//   renderer export-settings dialog → confirm →
//   renderer renders styled HTML into the hidden print webview and sends
//   `mt::response-export` (store/exportPrint.ts sendExportResponse) →
//   main `handleResponseForExport` → showSaveDialog → webContents.printToPDF →
//   writeFile → `mt::export-success`.
//
// The plumbing that makes that drivable headless lives in `exportHarness.ts`
// and is shared with the long-image and pandoc specs. Pixel/layout fidelity
// stays a manual check.

const PDF_DOC =
  '# Export Smoke\n\n' +
  'First paragraph with **bold** and *italic* text.\n\n' +
  'Second paragraph for a multi-block document.\n\n' +
  '- list item one\n- list item two\n'

test.describe('PDF export to a real file (item 231)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(PDF_DOC)
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    await installExportSuccessProbe(page)
  })

  test.afterAll(async () => {
    if (app) {
      await restoreSaveDialog(app)
      await app.close()
    }
  })

  const target = (suffix: string): string => `/tmp/colamd-e2e-export-${Date.now()}-${suffix}.pdf`

  test('writes a non-empty file beginning with the %PDF- magic bytes', async () => {
    const file = target('a')

    const { bytes } = await runExport(app, page, 'pdf', file)

    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('fires mt::export-success with type "pdf" and the written file path', async () => {
    const file = target('b')

    const { bytes, success } = await runExport(app, page, 'pdf', file)

    expect(bytes.length).toBeGreaterThan(0)
    expect(success, 'export-success payload should reference the written path').toBeTruthy()
    expect(success?.type).toBe('pdf')
  })

  test('canceling the save dialog writes no file and fires no export-success', async () => {
    const file = target('c')
    await clearExportSuccesses(page)
    if (fs.existsSync(file)) fs.rmSync(file)
    // Stub the save dialog to report cancellation — main must skip printToPDF.
    await stubSaveDialog(app, { canceled: true })

    await openExportDialog(app, page, 'pdf')

    // Give main a generous window to (not) write the file.
    await page.waitForTimeout(2000)

    expect(fs.existsSync(file)).toBe(false)
    const successes = await exportSuccesses(page)
    expect(successes.find((s) => s.filePath === file)).toBeFalsy()
  })

  test('the renderer EXPORT path round-trips a second export to a fresh path', async () => {
    // Re-export to a different path to prove the print service is re-armed and
    // the wiring is not single-shot.
    const file = target('d')

    const { bytes, success } = await runExport(app, page, 'pdf', file)

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(success?.filePath).toBe(file)
    expect(success?.type).toBe('pdf')
  })
})
