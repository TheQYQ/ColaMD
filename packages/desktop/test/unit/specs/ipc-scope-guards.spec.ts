import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return {
    ...electronCaptureMock(),
    dialog: { showSaveDialog: vi.fn() }
  }
})
vi.mock('fs-extra', () => ({ rename: vi.fn() }))

// file.ts pulls the updater-driven colamd helpers, the menu view helper and
// the i18n catalog at module scope; none of them is under test here.
vi.mock('main_renderer/menu/actions/colamd', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/menu/actions/view', () => ({
  showTabBar: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key
}))
vi.mock('main_renderer/utils/imageExport', () => ({
  exportDocumentImage: vi.fn()
}))
vi.mock('main_renderer/utils/pandoc', () => {
  const fn = Object.assign(vi.fn(), { exists: () => true })
  return { default: fn, exportViaPandoc: vi.fn() }
})
vi.mock('main_renderer/filesystem/markdown', () => ({
  writeMarkdownFile: vi.fn(async () => undefined)
}))

const { ipcRegistry, fromWebContentsMock } = await import('../mainHandlerHarness')
const { addAllowedRoot, clearAllowedRootsForTest } =
  await import('main_renderer/security/pathScope')
const { rename: fsRename } = await import('fs-extra')
const { dialog } = await import('electron')
const { registerUploaderHandlers } = await import('main_renderer/ipc/uploader')
await import('main_renderer/menu/actions/file')

// Batch 2 scope guards: the uploader used to hand any renderer-named local
// image to the upload program (exfiltration), and mt::response-file-move-to
// renamed from any renderer-named source path.

afterEach(() => {
  clearAllowedRootsForTest()
  vi.mocked(fsRename).mockClear()
})

const makeWin = (): { webContents: { send: ReturnType<typeof vi.fn> } } => ({
  webContents: { send: vi.fn() }
})

describe('mt::uploader::upload scope gate', () => {
  it('refuses to upload an image outside the allowed roots', async () => {
    clearAllowedRootsForTest()
    registerUploaderHandlers({
      dataCenter: { getItem: vi.fn(() => 'picgo') },
      preferences: { getItem: vi.fn(() => '') }
    } as never)

    // Platform-neutral absolute path outside every granted root — a hardcoded
    // "C:\..." is not absolute on POSIX and flips the test's meaning there.
    const outside = path.join(os.tmpdir(), `scope-out-${Date.now()}`, 'secret.png')
    await expect(invokeUpload({ pathname: outside, image: outside, isPath: true })).resolves.toBe(
      outside
    )
  })

  it('answers a non-image inside a granted root without uploading', async () => {
    registerUploaderHandlers({
      dataCenter: { getItem: vi.fn(() => 'picgo') },
      preferences: { getItem: vi.fn(() => '') }
    } as never)

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-granted-'))
    try {
      addAllowedRoot(root)
      const inside = path.join(root, 'picture.txt')
      await expect(invokeUpload({ pathname: root, image: inside, isPath: true })).resolves.toBe(
        inside
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

async function invokeUpload(req: unknown): Promise<unknown> {
  return invokeHandle('mt::uploader::upload', { sender: {} }, req)
}

function invokeHandle(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = ipcRegistry.handle.get(channel)
  if (!handler) throw new Error(`no ipcMain.handle registered for "${channel}"`)
  return Promise.resolve(handler(event, ...args))
}

describe('mt::response-file-move-to scope gate', () => {
  it('rejects a renderer-provided source path outside the allowed roots', async () => {
    clearAllowedRootsForTest()
    const win = makeWin()
    fromWebContentsMock.mockReturnValue(win)

    const handler = ipcRegistry.on.get('mt::response-file-move-to')
    if (!handler) throw new Error('mt::response-file-move-to not registered')

    const outside = path.join(os.tmpdir(), `scope-out-${Date.now()}`, 'doc.md')
    await handler({ sender: {} }, { id: 'tab-1', pathname: outside })

    expect(fsRename).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ type: 'error' })
    )
  })

  it('reaches the move dialog for a source inside a granted root', async () => {
    const win = makeWin()
    fromWebContentsMock.mockReturnValue(win)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      filePath: undefined,
      canceled: true
    } as never)

    const handler = ipcRegistry.on.get('mt::response-file-move-to')
    if (!handler) throw new Error('mt::response-file-move-to not registered')

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-granted-'))
    try {
      addAllowedRoot(root)
      await handler({ sender: {} }, { id: 'tab-1', pathname: path.join(root, 'doc.md') })

      expect(fsRename).not.toHaveBeenCalled() // dialog was canceled
      expect(win.webContents.send).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
