import { type BrowserWindow } from 'electron'
import { typedSend } from '../../ipc/typedSend'

export const showAboutDialog = (win: BrowserWindow | null | undefined): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::about-dialog')
  }
}
