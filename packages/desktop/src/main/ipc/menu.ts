import path from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { openFileOrFolder } from '../menu/actions/file'
import {
  readRecentlyUsedDocuments,
  RECENTLY_USED_DOCUMENTS_FILE_NAME
} from '../utils/recentDocuments'

// Frameless windows render their menu bar in the renderer (menuBar component).
// These channels back the pieces of that menu the renderer cannot reach on its
// own: the recently-used-documents list (owned by the main-process AppMenu),
// native clipboard edits routed through webContents, and opening a recent
// file/folder entry through the same trusted path the native menu uses.

const recentsPath = (): string =>
  path.join(app.getPath('userData'), RECENTLY_USED_DOCUMENTS_FILE_NAME)

export const registerMenuHandlers = (): void => {
  ipcMain.handle('mt::menu::get-recent-documents', () => readRecentlyUsedDocuments(recentsPath()))

  ipcMain.on('mt::menu::open-path', (event, pathname: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof pathname !== 'string' || !pathname) return
    openFileOrFolder(win, pathname)
  })

  ipcMain.on('mt::menu::native-clipboard', (event, op: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (op === 'cut') win.webContents.cut()
    else if (op === 'copy') win.webContents.copy()
    else if (op === 'paste') win.webContents.paste()
  })
}
