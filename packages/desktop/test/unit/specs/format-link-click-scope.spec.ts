import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Batch C — mt::format-link-click: the href comes from the rendered document,
// so a hostile document controls `dirname` + `href` and thereby the joined
// `pathname`. Both exits were ungated: the markdown branch runs
// openFileOrFolder, which addAllowedRoot's the target's dirname (a
// document-controlled grant!) and opens a tab (content disclosure); the other
// branch hands the path to shell.openPath (OS-level open, guarded only by the
// dangerous-executable confirm). The scope assert goes in before both exits.
// Links to what this session already opened keep working — argv/startup grants
// the document's own directory, which is where relative links point.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return {
    ...electronCaptureMock(),
    app: { quit: vi.fn(), getPath: vi.fn(() => os.tmpdir()) },
    dialog: {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showOpenDialog: vi.fn(async () => ({ filePaths: [], canceled: true }))
    },
    shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() }
  }
})

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

// file.ts pulls the updater-driven colamd helpers, the menu view helper and
// the i18n catalog at module scope; none of them is under test here.
vi.mock('main_renderer/menu/actions/colamd', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/menu/actions/view', () => ({ showTabBar: vi.fn() }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
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

import { dialog, ipcMain, shell } from 'electron'
import log from 'electron-log'
import { fromWebContentsMock, ipcRegistry } from '../mainHandlerHarness'

const { addAllowedRoot, clearAllowedRootsForTest, getAllowedRoots } =
  await import('main_renderer/security/pathScope')
const { normalizeAndResolvePath } = await import('main_renderer/filesystem')

// Loading the module is what registers mt::format-link-click and openFile.
await import('main_renderer/menu/actions/file')

type SendSpy = ReturnType<typeof vi.fn>

const driveLink = async (href: string, dirname?: string): Promise<SendSpy> => {
  const handler = ipcRegistry.on.get('mt::format-link-click')
  if (!handler) throw new Error('mt::format-link-click not registered')
  const send = vi.fn()
  fromWebContentsMock.mockReturnValue({ id: 9, webContents: { send } })
  await handler({ sender: {} }, { data: { href }, dirname })
  return send
}

describe('mt::format-link-click is scoped', () => {
  let docDir = ''
  let outsideDir = ''
  const cleanup: string[] = []

  beforeEach(() => {
    clearAllowedRootsForTest()
    vi.mocked(log.warn).mockClear()
    vi.mocked(ipcMain.emit).mockClear()
    vi.mocked(shell.openPath).mockClear()
    vi.mocked(dialog.showMessageBox).mockClear()
    docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colamd-linkdoc-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colamd-linkout-'))
    cleanup.push(docDir, outsideDir)
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a markdown link outside the granted roots before openFileOrFolder can grant', async () => {
    const target = path.join(outsideDir, 'secret.md')
    fs.writeFileSync(target, '# secret\n')

    const send = await driveLink('secret.md', docDir)

    expect(ipcMain.emit).not.toHaveBeenCalledWith(
      'app-open-file-by-id',
      expect.anything(),
      expect.anything()
    )
    expect(getAllowedRoots()).not.toContain(normalizeAndResolvePath(outsideDir))
    expect(send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ title: 'dialog.openFailure', type: 'error' })
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('mt::format-link-click'),
      expect.anything(),
      expect.anything()
    )
  })

  it('opens a markdown link inside a granted root through openFileOrFolder', async () => {
    addAllowedRoot(docDir)
    const target = path.join(docDir, 'other.md')
    fs.writeFileSync(target, '# other\n')

    const send = await driveLink('other.md', docDir)

    expect(ipcMain.emit).toHaveBeenCalledWith(
      'app-open-file-by-id',
      9,
      normalizeAndResolvePath(target)
    )
    // openFileOrFolder re-grants the target dirname — allowed here because
    // the target already sits inside a granted root (no new power).
    expect(getAllowedRoots()).toContain(normalizeAndResolvePath(docDir))
    expect(send).not.toHaveBeenCalledWith('mt::show-notification', expect.anything())
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('opens a non-markdown file inside a granted root via the shell', async () => {
    addAllowedRoot(docDir)
    // `.txt` counts as a markdown extension here, so use a real non-md file.
    const target = path.join(docDir, 'shot.png')
    fs.writeFileSync(target, 'PNG')

    await driveLink('shot.png', docDir)

    expect(shell.openPath).toHaveBeenCalledWith(path.normalize(target))
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('refuses an out-of-scope executable before the confirmation dialog', async () => {
    const target = path.join(outsideDir, 'evil.exe')
    fs.writeFileSync(target, 'MZ')

    const send = await driveLink('evil.exe', docDir)

    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ title: 'dialog.openFailure', type: 'error' })
    )
  })

  it('still asks for confirmation before opening an in-scope executable', async () => {
    addAllowedRoot(docDir)
    const target = path.join(docDir, 'setup.exe')
    fs.writeFileSync(target, 'MZ')

    await driveLink('setup.exe', docDir)

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'warning' })
    )
    // Default dialog answer is cancel: openPath stays untouched.
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('File > Open dialog grants every picked dirname before emitting', async () => {
    const pickedA = path.join(docDir, 'a.md')
    const pickedB = path.join(outsideDir, 'b.md')
    fs.writeFileSync(pickedA, '# a\n')
    fs.writeFileSync(pickedB, '# b\n')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      filePaths: [pickedA, pickedB],
      canceled: false
    } as never)

    const { openFile } = await import('main_renderer/menu/actions/file')
    await openFile({ id: 11, webContents: { send: vi.fn() } } as never)

    expect(getAllowedRoots()).toContain(normalizeAndResolvePath(docDir))
    expect(getAllowedRoots()).toContain(normalizeAndResolvePath(outsideDir))
    expect(ipcMain.emit).toHaveBeenCalledWith('app-open-files-by-id', 11, [pickedA, pickedB])
  })
})
