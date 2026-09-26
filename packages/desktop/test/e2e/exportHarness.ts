import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import { sendIpcToRenderer } from './helpers'

// Shared seams for the export specs (`export-pdf.spec.ts`,
// `export-long-image-and-pandoc.spec.ts`). An export needs three things a
// headless run cannot do on its own: a save dialog that answers instead of the
// user, a way to see that main finished, and a record of what main reported
// back. Keep that plumbing here so a new export format buys all three.

/** The full renderer → main → disk path for one export, minus the assertions. */
export interface ExportRun {
  bytes: Buffer
  success?: { type?: string; filePath?: string }
}

/**
 * Replace `dialog.showSaveDialog` in the MAIN process with an instant answer.
 * The native picker is the only non-headless seam left in an export; everything
 * upstream of it (menu command, export dialog, styled HTML, `mt::response-export`)
 * runs for real. Pass `canceled` to test the "user backed out" branch.
 */
export const stubSaveDialog = async (
  app: ElectronApplication,
  target: { canceled: false; filePath: string } | { canceled: true }
): Promise<void> => {
  await app.evaluate(({ dialog }, answer) => {
    const g = global as unknown as { __colamd_orig_save_dialog__?: unknown }
    if (!g.__colamd_orig_save_dialog__) {
      g.__colamd_orig_save_dialog__ = dialog.showSaveDialog.bind(dialog)
    }
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => answer
  }, target)
}

export const restoreSaveDialog = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ dialog }) => {
    const g = global as unknown as {
      __colamd_orig_save_dialog__?: typeof dialog.showSaveDialog
    }
    if (g.__colamd_orig_save_dialog__) {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
        g.__colamd_orig_save_dialog__
    }
  })
}

/**
 * Watch `mt::export-success` from the renderer side. The app has its own
 * listener that pops the confirm toast; this one exists only so a spec can see
 * the payload main sent.
 */
export const installExportSuccessProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const w = window as unknown as {
      __mt_export_success__?: Array<{ type?: string; filePath?: string }>
      __mt_export_probe_installed__?: boolean
    }
    if (w.__mt_export_probe_installed__) return
    w.__mt_export_probe_installed__ = true
    const sink: Array<{ type?: string; filePath?: string }> = []
    w.__mt_export_success__ = sink
    window.electron.ipcRenderer.on('mt::export-success', (_e: unknown, payload: unknown) => {
      sink.push((payload ?? {}) as { type?: string; filePath?: string })
    })
  })
}

export const exportSuccesses = async (
  page: Page
): Promise<Array<{ type?: string; filePath?: string }>> => {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __mt_export_success__?: Array<{ type?: string; filePath?: string }>
    }
    return (w.__mt_export_success__ ?? []).slice()
  })
}

export const clearExportSuccesses = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const w = window as unknown as { __mt_export_success__?: Array<unknown> }
    if (w.__mt_export_success__) w.__mt_export_success__.length = 0
  })
}

/** Wait until main has written a non-empty file. */
const waitForFile = async (filePath: string, timeoutMs: number): Promise<Buffer> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath)
      if (data.length > 0) return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Export file was not written within ${timeoutMs}ms: ${filePath}`)
}

/**
 * Open the export dialog the way the Export menu item does, and confirm it.
 * Returns as soon as the click lands — the writing happens in main.
 */
export const openExportDialog = async (
  app: ElectronApplication,
  page: Page,
  type: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::show-export-dialog', type)
  const confirm = page.locator('.print-settings-dialog .button-primary')
  await confirm.waitFor({ state: 'visible', timeout: 15_000 })
  await confirm.click()
}

/**
 * Drive one export end to end: the same IPC the Export menu item sends, the
 * real export-settings dialog, main's writer, and the answer back.
 * `timeoutMs` covers the formats that shell out to pandoc.
 */
export const runExport = async (
  app: ElectronApplication,
  page: Page,
  type: string,
  filePath: string,
  timeoutMs = 20_000
): Promise<ExportRun> => {
  if (fs.existsSync(filePath)) fs.rmSync(filePath)
  await clearExportSuccesses(page)
  await stubSaveDialog(app, { canceled: false, filePath })

  await openExportDialog(app, page, type)

  const bytes = await waitForFile(filePath, timeoutMs)
  // The file is the evidence, and it is already read: leaving exports in /tmp
  // would outlive the run.
  fs.rmSync(filePath, { force: true })
  // The success notification is sent after the write lands, so reading the
  // probe once can miss it on a fast runner — poll within the same budget.
  const deadline = Date.now() + timeoutMs
  let successes = await exportSuccesses(page)
  while (Date.now() < deadline && !successes.some((s) => s.filePath === filePath)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    successes = await exportSuccesses(page)
  }
  return { bytes, success: successes.find((s) => s.filePath === filePath) }
}
