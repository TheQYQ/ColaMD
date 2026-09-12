import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { isDirectory2, isFile2 } from 'common/filesystem'
import log from 'electron-log'
import { openFileOrFolder } from '../menu/actions/file'

// Frameless windows render their menu bar in the renderer (menuBar component).
// These channels back the pieces of that menu the renderer cannot reach on its
// own: the recently-used-documents list (owned by the main-process AppMenu),
// native clipboard edits routed through webContents, and opening a recent
// file/folder entry through the same trusted path the native menu uses.

const RECENTLY_USED_DOCUMENTS_FILE_NAME = 'recently-used-documents.json'
const MAX_RECENTLY_USED_DOCUMENTS = 12

const readRecentlyUsedDocuments = (): string[] => {
  const recentsPath = path.join(app.getPath('userData'), RECENTLY_USED_DOCUMENTS_FILE_NAME)
  if (!isFile2(recentsPath)) return []

  try {
    const recentDocuments: string[] = JSON.parse(fs.readFileSync(recentsPath, 'utf-8')).filter(
      (f: string) => f && (isFile2(f) || isDirectory2(f))
    )
    return recentDocuments.slice(0, MAX_RECENTLY_USED_DOCUMENTS)
  } catch (err) {
    log.error('Error while reading recently used documents:', err)
    return []
  }
}

export const registerMenuHandlers = (): void => {
  ipcMain.handle('mt::menu::get-recent-documents', () => readRecentlyUsedDocuments())

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
