import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { isDirectory } from 'common/filesystem'
import type {
  ElectronOpenDialogOptions,
  ElectronOpenDialogResult,
  ElectronSaveDialogOptions,
  ElectronSaveDialogResult,
  ElectronMessageBoxOptions
} from '@shared/types/dialog'
import { addAllowedRoot } from '../security/pathScope'
import { typedHandle } from './typedHandle'

/**
 * `registerDialogHandlers` wires the `mt::dialog::*` invoke channels. The
 * renderer can't call `dialog.show*` directly (it needs a `BrowserWindow`
 * handle and the renderer is sandboxed), so each channel resolves to the
 * matching `dialog.show*` call in the main process. The BrowserWindow is
 * derived from the IpcMainEvent sender — same pattern as `mt::win::*`.
 */

const windowFromEvent = (sender: Electron.WebContents): BrowserWindow | null =>
  BrowserWindow.fromWebContents(sender)

// A path the user just confirmed in a native dialog is the same trust event as
// opening a file from the menu, so it grants the same root — `openFileOrFolder`
// (menu/actions/file.ts:878-881) already does exactly this. The folder itself is
// granted when a directory was picked; otherwise the containing folder, so a
// not-yet-existing save target still grants its directory.
//
// This is the prerequisite for scoping the read channels (O7②): the renderer
// reads back what the picker returned (`prefComponents/theme/index.vue:216`), so
// without a grant here there is no scope a read could be checked against.
const grantPickedPaths = (filePaths: readonly string[]): void => {
  for (const picked of filePaths) {
    if (!picked) continue
    addAllowedRoot(isDirectory(picked) ? picked : path.dirname(picked))
  }
}

const grantedOpenResult = (result: ElectronOpenDialogResult): ElectronOpenDialogResult => {
  if (!result.canceled) grantPickedPaths(result.filePaths)
  return result
}

const grantedSaveResult = (result: ElectronSaveDialogResult): ElectronSaveDialogResult => {
  if (!result.canceled && result.filePath) grantPickedPaths([result.filePath])
  return result
}

export const registerDialogHandlers = (): void => {
  typedHandle('mt::dialog::open', async (event, options: ElectronOpenDialogOptions) => {
    const win = windowFromEvent(event.sender)
    return grantedOpenResult(await dialog.showOpenDialog(win!, options))
  })

  typedHandle('mt::dialog::save', async (event, options: ElectronSaveDialogOptions) => {
    const win = windowFromEvent(event.sender)
    return grantedSaveResult(await dialog.showSaveDialog(win!, options))
  })

  typedHandle('mt::dialog::message-box', async (event, options: ElectronMessageBoxOptions) => {
    const win = windowFromEvent(event.sender)
    return dialog.showMessageBox(win!, options)
  })

  typedHandle('mt::dialog::error-box', (_event, title: string, content: string) => {
    dialog.showErrorBox(title, content)
  })
}
