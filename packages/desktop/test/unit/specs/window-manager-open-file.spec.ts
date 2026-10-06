import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Batch B — mt::open-file: the renderer can name any path here and the tab
// opens with a read of it (editor.openTab does not authorize). Unlike
// mt::open-file-by-window-id, nothing has ever gated this channel, so a
// compromised renderer could forge it for an arbitrary existing file. The
// window-creation routes already pass authorized paths (editor.ts), so a
// scope check costs the legitimate caller nothing.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return { ...electronCaptureMock(), app: { quit: vi.fn() } }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
// ced is a native addon and CI's node ABI has no prebuilt binding for it
// (electron-rebuild only produces the Electron one). windowManager pulls it
// in via Watcher -> filesystem/markdown -> encoding, but none of these tests
// call guessEncoding, so stub the import instead of loading the binding.
vi.mock('ced', () => ({ default: vi.fn() }))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key,
  setLanguage: vi.fn()
}))

import log from 'electron-log'
import { fromWebContentsMock, ipcRegistry, resetIpcRegistry } from '../mainHandlerHarness'
import WindowManager from '../../../src/main/app/windowManager'
import { addAllowedRoot, clearAllowedRootsForTest } from '../../../src/main/security/pathScope'

type WindowManagerParams = ConstructorParameters<typeof WindowManager>

const makeManager = (): WindowManager => {
  const appMenu = {
    has: () => true,
    addDefaultMenu: vi.fn(),
    removeWindowMenu: vi.fn()
  } as unknown as WindowManagerParams[0]
  const preferences = { getItem: () => false } as unknown as WindowManagerParams[1]
  const editorBufferStore = { handleClose: vi.fn() } as unknown as WindowManagerParams[2]
  return new WindowManager(appMenu, preferences, editorBufferStore)
}

const drive = async (channel: string, ...payload: unknown[]): Promise<void> => {
  const handler = ipcRegistry.on.get(channel)
  if (!handler) {
    throw new Error(`no ipcMain.on registered for "${channel}"`)
  }
  await handler({ sender: {} }, ...payload)
}

describe('mt::open-file is scoped', () => {
  let insideDir = ''
  let outsideDir = ''
  const cleanup: string[] = []

  const fakeWindow = (openTab: ReturnType<typeof vi.fn>) => ({
    id: 7,
    webContents: { send: vi.fn() },
    openTab
  })

  // The handler looks the editor up by window id in the manager's map — that
  // is where openTab must land, not on the BrowserWindow itself.
  const registerWindow = (wm: WindowManager, win: ReturnType<typeof fakeWindow>): void => {
    ;(wm as unknown as { _windows: Map<number, unknown> })._windows.set(win.id, {
      openTab: win.openTab
    })
  }

  beforeEach(() => {
    resetIpcRegistry()
    clearAllowedRootsForTest()
    vi.mocked(log.warn).mockClear()
    insideDir = mkdtempSync(path.join(tmpdir(), 'colamd-inside-'))
    outsideDir = mkdtempSync(path.join(tmpdir(), 'colamd-outside-'))
    cleanup.push(insideDir, outsideDir)
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a path outside the granted roots and tells the window', async () => {
    const outsideFile = path.join(outsideDir, 'victim.md')
    writeFileSync(outsideFile, '# nope')
    addAllowedRoot(insideDir)

    const openTab = vi.fn()
    const win = fakeWindow(openTab)
    fromWebContentsMock.mockReturnValue(win)
    const wm = makeManager()
    registerWindow(wm, win)

    await drive('mt::open-file', outsideFile, { id: 'forged' })

    expect(openTab).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ type: 'error', title: 'dialog.openFailure' })
    )
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(outsideFile))
  })

  it('opens a file inside a granted root, forwarding the original arguments', async () => {
    const insideFile = path.join(insideDir, 'doc.md')
    writeFileSync(insideFile, '# yes')
    addAllowedRoot(insideDir)

    const openTab = vi.fn()
    const win = fakeWindow(openTab)
    fromWebContentsMock.mockReturnValue(win)
    const wm = makeManager()
    registerWindow(wm, win)

    await drive('mt::open-file', insideFile, { id: 'tab-1', history: true })

    expect(openTab).toHaveBeenCalledWith(insideFile, { id: 'tab-1', history: true }, true)
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
