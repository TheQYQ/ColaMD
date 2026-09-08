/**
 * Shared dialog option/result types so the renderer and main process agree on
 * the shape passed through `mt::dialog::*` IPC channels. Mirrors a narrow
 * subset of Electron's `Dialog` return types — intentionally decoupled so the
 * renderer never imports from `electron` (it can't; it's sandboxed).
 */

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface ElectronOpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: FileFilter[]
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >
  message?: string
}

export interface ElectronOpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface ElectronSaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: FileFilter[]
  message?: string
  nameFieldLabel?: string
  showsTagField?: boolean
}

export interface ElectronSaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface ElectronMessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}

export interface ElectronMessageBoxResult {
  response: number
  checkboxChecked?: boolean
}
