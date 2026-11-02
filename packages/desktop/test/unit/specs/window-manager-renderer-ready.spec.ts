import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// #GUI-B5: the editor page reports `mt::renderer-ready` once its own `mt::*`
// listeners exist, and the window manager unlocks that window's held sends. The
// signal carries no window id on purpose — resolving the window from the
// *sender* is what stops one renderer from releasing another window's queue.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return { ...electronCaptureMock(), app: { quit: vi.fn() } }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('ced', () => ({ default: vi.fn() }))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key,
  setLanguage: vi.fn()
}))

import { fromWebContentsMock, ipcRegistry, resetIpcRegistry } from '../mainHandlerHarness'
import WindowManager from '../../../src/main/app/windowManager'

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

const fakeEditor = (id: number) => {
  const markRendererReady = vi.fn()
  const editor = { id, markRendererReady }
  return { editor, markRendererReady }
}

const registerEditor = (wm: WindowManager, id: number, editor: unknown): void => {
  ;(wm as unknown as { _windows: Map<number, unknown> })._windows.set(id, editor)
}

const drive = async (sender: unknown): Promise<void> => {
  const handler = ipcRegistry.on.get('mt::renderer-ready')
  if (!handler) {
    throw new Error('no ipcMain.on registered for "mt::renderer-ready"')
  }
  await handler({ sender })
}

describe('mt::renderer-ready', () => {
  beforeEach(() => {
    resetIpcRegistry()
    fromWebContentsMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('releases the queue of the window that sent the signal', async () => {
    const wm = makeManager()
    const { editor, markRendererReady } = fakeEditor(7)
    registerEditor(wm, 7, editor)
    const sender = { url: 'file://editor-7' }
    fromWebContentsMock.mockImplementation((s: unknown) => (s === sender ? { id: 7 } : null))

    await drive(sender)

    expect(markRendererReady).toHaveBeenCalledTimes(1)
  })

  it('leaves every other window held, because the sender decides', async () => {
    const wm = makeManager()
    const a = fakeEditor(7)
    const b = fakeEditor(8)
    registerEditor(wm, 7, a.editor)
    registerEditor(wm, 8, b.editor)
    const sender = { url: 'file://editor-8' }
    fromWebContentsMock.mockImplementation((s: unknown) => (s === sender ? { id: 8 } : null))

    await drive(sender)

    expect(b.markRendererReady).toHaveBeenCalledTimes(1)
    expect(a.markRendererReady).not.toHaveBeenCalled()
  })

  it('ignores a signal that does not come from a live window', async () => {
    const wm = makeManager()
    const { editor, markRendererReady } = fakeEditor(7)
    registerEditor(wm, 7, editor)
    fromWebContentsMock.mockReturnValue(null)

    await expect(drive('destroyed-webcontents')).resolves.toBeUndefined()

    expect(markRendererReady).not.toHaveBeenCalled()
  })
})
