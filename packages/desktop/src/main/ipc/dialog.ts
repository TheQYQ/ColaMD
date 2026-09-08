import { dialog, ipcMain, BrowserWindow } from 'electron'
import type {
  ElectronOpenDialogOptions,
  ElectronSaveDialogOptions,
  ElectronMessageBoxOptions
} from '@shared/types/dialog'

/**
 * `registerDialogHandlers` wires the `mt::dialog::*` invoke channels. The
 * renderer can't call `dialog.show*` directly (it needs a `BrowserWindow`
 * handle and the renderer is sandboxed), so each channel resolves to the
 * matching `dialog.show*` call in the main process. The BrowserWindow is
 * derived from the IpcMainEvent sender — same pattern as `mt::win::*`.
 */

const windowFromEvent = (sender: Electron.WebContents): BrowserWindow | null =>
  BrowserWindow.fromWebContents(sender)

export const registerDialogHandlers = (): void => {
  ipcMain.handle('mt::dialog::open', async(event, options: ElectronOpenDialogOptions) => {
    const win = windowFromEvent(event.sender)
    return dialog.showOpenDialog(win!, options)
  })

  ipcMain.handle('mt::dialog::save', async(event, options: ElectronSaveDialogOptions) => {
    const win = windowFromEvent(event.sender)
    return dialog.showSaveDialog(win!, options)
  })

  ipcMain.handle('mt::dialog::message-box', async(event, options: ElectronMessageBoxOptions) => {
    const win = windowFromEvent(event.sender)
    return dialog.showMessageBox(win!, options)
  })

  ipcMain.handle('mt::dialog::error-box', (_event, title: string, content: string) => {
    dialog.showErrorBox(title, content)
  })
}
