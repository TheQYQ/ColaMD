import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

// O7② step 1 — before the read channels can be scoped, a path the user just
// confirmed in a native dialog has to become a grant. It is the same trust event
// as opening a file from the menu (`menu/actions/file.ts:878-881` already grants
// on that), and the renderer really does read picker results back: theme import
// takes `filePaths[0]` straight into `fileUtils.readFile`
// (`prefComponents/theme/index.vue:216`).

const { handleChannels, showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  handleChannels: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
  dialog: { showOpenDialog, showSaveDialog },
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handleChannels.set(channel, listener)
    }
  }
}))

// The handler only asks whether a picked path is a directory; a unit run has no
// filesystem behind these paths.
vi.mock('common/filesystem', () => ({
  isDirectory: (p: string) => p === '/picked/folder'
}))

import { registerDialogHandlers } from '../../../src/main/ipc/dialog'
import { clearAllowedRootsForTest, getAllowedRoots } from '../../../src/main/security/pathScope'

registerDialogHandlers()

const invoke = async(channel: string, ...args: unknown[]): Promise<unknown> => {
  const listener = handleChannels.get(channel)
  if (!listener) throw new Error(`nothing listens on ${channel}`)
  return listener({ sender: {} }, ...args)
}

describe('a dialog result grants the scope it names', () => {
  beforeEach(() => {
    clearAllowedRootsForTest()
    showOpenDialog.mockReset()
    showSaveDialog.mockReset()
  })

  it('grants the containing folder of a picked file', async() => {
    const picked = '/picked/by/user/theme.colamd-theme'
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] })

    const result = await invoke('mt::dialog::open', { properties: ['openFile'] })

    expect(getAllowedRoots()).toEqual([path.resolve('/picked/by/user')])
    // The grant must not disturb what the caller receives.
    expect(result).toEqual({ canceled: false, filePaths: [picked] })
  })

  it('grants a picked directory itself rather than its parent', async() => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/picked/folder'] })

    await invoke('mt::dialog::open', { properties: ['openDirectory'] })

    expect(getAllowedRoots()).toEqual([path.resolve('/picked/folder')])
  })

  it('grants the folder of a save target that does not exist yet', async() => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/export/here.md' })

    await invoke('mt::dialog::save', {})

    expect(getAllowedRoots()).toEqual([path.resolve('/export')])
  })

  it('grants every path of a multi-selection result', async() => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/a/one.md', '/b/two.md']
    })

    await invoke('mt::dialog::open', { properties: ['openFile', 'multiSelections'] })

    expect(getAllowedRoots().sort()).toEqual([path.resolve('/a'), path.resolve('/b')].sort())
  })

  it('grants nothing when the user cancels', async() => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    showSaveDialog.mockResolvedValue({ canceled: true })

    await invoke('mt::dialog::open', {})
    await invoke('mt::dialog::save', {})

    expect(getAllowedRoots()).toEqual([])
  })
})
