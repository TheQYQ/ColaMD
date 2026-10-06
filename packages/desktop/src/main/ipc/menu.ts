import path from 'path'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log'
import { isDirectory, isFile } from 'common/filesystem'
import { openFileOrFolder } from '../menu/actions/file'
import { normalizeAndResolvePath } from '../filesystem'
import { t } from '../i18n'
import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'
import {
  readRecentlyUsedDocuments,
  RECENTLY_USED_DOCUMENTS_FILE_NAME
} from '../utils/recentDocuments'
import { typedOn } from './typedOn'

// Frameless windows render their menu bar in the renderer (menuBar component).
// These channels back the pieces of that menu the renderer cannot reach on its
// own: the recently-used-documents list (owned by the main-process AppMenu),
// native clipboard edits routed through webContents, and opening a recent
// file/folder entry through the same trusted path the native menu uses.

const recentsPath = (): string =>
  path.join(app.getPath('userData'), RECENTLY_USED_DOCUMENTS_FILE_NAME)

export const registerMenuHandlers = (): void => {
  typedHandle('mt::menu::get-recent-documents', () => readRecentlyUsedDocuments(recentsPath()))

  // Batch B: openFileOrFolder grants the write scope of whatever it opens, so
  // this channel accepts nothing but a path main itself put on the recents
  // list (the renderer only echoes get-recent-documents back). A path that is
  // NOT on the list may still flow through when it no longer exists — then
  // openFileOrFolder grants nothing and owns the "removed on disk" notice.
  typedOn('mt::menu::open-path', (event, pathname: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof pathname !== 'string' || !pathname) return
    const recents = readRecentlyUsedDocuments(recentsPath())
    if (!recents.includes(pathname)) {
      const resolved = normalizeAndResolvePath(pathname)
      if (isFile(resolved) || isDirectory(resolved)) {
        log.warn(`Refusing to open path outside the recent documents list: "${pathname}"`)
        typedSend(win.webContents, 'mt::show-notification', {
          title: t('dialog.openFailure'),
          type: 'error',
          message: t('dialog.openRefused', { name: path.basename(pathname) })
        })
        return
      }
    }
    openFileOrFolder(win, pathname)
  })

  typedOn('mt::menu::native-clipboard', (event, op: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (op === 'cut') win.webContents.cut()
    else if (op === 'copy') win.webContents.copy()
    else if (op === 'paste') win.webContents.paste()
  })
}
