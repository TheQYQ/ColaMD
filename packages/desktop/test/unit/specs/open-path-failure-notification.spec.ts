import { beforeEach, describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { getPath: () => '/tmp', getName: () => 'colamd', getVersion: () => '0', on: () => {} },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
    showItemInFolder: vi.fn()
  },
  shell: { openPath: vi.fn(), openExternal: vi.fn(), showItemInFolder: vi.fn() },
  ipcMain: { on: () => {}, handle: () => {}, emit: () => {} },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeTheme: { shouldUseDarkColors: false },
  clipboard: { readText: () => '', writeText: () => {} }
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

// The update-check module builds an electron-updater instance at import time,
// which needs a live `app.getVersion`. Nothing on this path touches it.
vi.mock('../../../src/main/menu/actions/colamd', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))

// Deterministic translations: the assertion is about *which* message the window
// is told, not about the locale catalog. Mirrors what `main/i18n#t` returns when
// a catalog cannot be loaded, plus the substituted parameter.
vi.mock('../../../src/main/i18n', () => ({
  t: (key: string, params: Record<string, string | number> = {}) =>
    params.name === undefined ? key : `${key}:${params.name}`,
  setLanguage: () => {}
}))

import type { BrowserWindow } from 'electron'
import { openFileOrFolder } from '../../../src/main/menu/actions/file'

const win = {
  id: 7,
  webContents: { send },
  isDestroyed: () => false
} as unknown as BrowserWindow

// Recently-used entries are filtered against the disk when the menu is built, so
// the only way to click one that fails is a file deleted between building and
// clicking. `openFileOrFolder` used to answer that with `console.error`, i.e. the
// menu click did nothing at all — rename and move already report through
// `mt::show-notification`, opening did not.
describe('O18 — a failed open must be visible', () => {
  beforeEach(() => send.mockClear())

  it('notifies the window when the path is neither a file nor a directory', () => {
    openFileOrFolder(win, '/colamd-removed-recently-used-zz7x/notes.md')
    expect(send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({
        type: 'error',
        title: 'dialog.openFailure',
        message: 'store.editor.fileRemovedOnDisk:notes.md'
      })
    )
  })

  it('does not notify when the path can be opened', () => {
    openFileOrFolder(win, process.cwd())
    expect(send).not.toHaveBeenCalled()
  })
})
