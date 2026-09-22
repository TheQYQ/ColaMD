import type { BrowserWindow } from 'electron'
import { COMMANDS, type CommandManager, type CommandCallback } from './index'
import { typedSend } from '../ipc/typedSend'

const openQuickOpenDialog = (win: BrowserWindow | null | undefined): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::execute-command-by-id', 'file.quick-open')
  }
}

export const loadFileCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.FILE_QUICK_OPEN, openQuickOpenDialog as CommandCallback)
}
