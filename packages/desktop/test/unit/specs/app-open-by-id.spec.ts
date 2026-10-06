import path from 'path'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Batch C — app-open-files-by-id / app-open-directory-by-id are registered
// through onInternalChannel, which is plain ipcMain.on: a compromised renderer
// can forge them (both sit in the accidental-reachability set). The sibling
// app-open-file-by-id already asserts scope because opening a tab discloses
// file content; these two never did. Trusted callers grant the root right
// before emitting (openFileOrFolder, and the File > Open dialog grant), so
// the assert passes for them and only for them.
//
// Renderer-path emulation: ipcRenderer.send prepends an IpcMainEvent, so the
// listener's first declared parameter binds to the event and the attacker
// controls the rest. Driving with `emitOn(channel, fakeEvent, ...payload)`
// reproduces that shift; `fakeEvent.id` doubles as the window id, which is
// exactly how a forged same-window send reaches editor lookups today.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return {
    ...electronCaptureMock(),
    app: {
      quit: vi.fn(),
      getPath: vi.fn(() => tmpdir()),
      getName: vi.fn(() => 'colamd'),
      on: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve())
    },
    clipboard: { readImage: vi.fn(), writeImage: vi.fn() },
    dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
    nativeTheme: { themeSource: 'system', on: vi.fn(), shouldUseDarkColors: false },
    shell: { openPath: vi.fn(), openExternal: vi.fn(), trashItem: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
    Notification: vi.fn()
  }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key,
  setLanguage: vi.fn()
}))
vi.mock('main_renderer/keyboard', () => ({ registerKeyboardListeners: vi.fn() }))
vi.mock('main_renderer/menu/actions/colamd', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/menu/actions/view', () => ({ showTabBar: vi.fn() }))
vi.mock('main_renderer/utils/imageExport', () => ({ exportDocumentImage: vi.fn() }))
vi.mock('main_renderer/utils/pandoc', () => {
  const fn = Object.assign(vi.fn(), { exists: () => true })
  return { default: fn, exportViaPandoc: vi.fn() }
})
vi.mock('main_renderer/filesystem/markdown', () => ({
  normalizeMarkdownPath: (pathname: string) => ({ isDir: false, path: pathname }),
  writeMarkdownFile: vi.fn(),
  loadMarkdownFile: vi.fn()
}))

import log from 'electron-log'
import { resetIpcRegistry } from '../mainHandlerHarness'
import App from '../../../src/main/app/index'
import { addAllowedRoot, clearAllowedRootsForTest } from '../../../src/main/security/pathScope'

type EditorStub = {
  openTabsFromPaths: ReturnType<typeof vi.fn>
  openFolder: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
}

const makeApp = (prefs: Record<string, unknown>): { editor: EditorStub } => {
  const editor: EditorStub = {
    openTabsFromPaths: vi.fn(),
    openFolder: vi.fn(),
    openTab: vi.fn()
  }
  const windowManager = {
    get: vi.fn(() => editor),
    windows: new Map(),
    getActiveEditorId: () => null,
    findBestWindowToOpenIn: () => [],
    getWindowsByType: () => []
  }
  const accessor = {
    windowManager,
    preferences: {
      getItem: (key: string) => prefs[key],
      getAll: () => prefs
    },
    keybindings: {
      keys: new Map(),
      getDefaultKeybindings: () => ({}),
      getUserKeybindings: () => ({})
    },
    menu: { updateKeybindings: vi.fn() }
  }
  // The App constructor is what registers the app-open-* handlers; keep the
  // instance referenced (`_app`) so the side-effect-only construction passes
  // no-new while the listeners stay reachable through the registry.
  const _app = new App(accessor as never, { _: [] })
  return { editor }
}

const drive = async (channel: string, ...payload: unknown[]): Promise<void> => {
  const handler = (await import('../mainHandlerHarness')).ipcRegistry.on.get(channel)
  if (!handler) {
    throw new Error(`no ipcMain.on registered for "${channel}"`)
  }
  // The event slot is positional: renderer sends always prepend it.
  await handler({ id: 7, sender: {} }, ...payload)
}

describe('app-open-by-id channels are scoped', () => {
  let outsideDir = ''
  let insideDir = ''
  const cleanup: string[] = []

  beforeEach(() => {
    resetIpcRegistry()
    clearAllowedRootsForTest()
    vi.mocked(log.warn).mockClear()
    insideDir = mkdtempSync(path.join(tmpdir(), 'colamd-c-inside-'))
    outsideDir = mkdtempSync(path.join(tmpdir(), 'colamd-c-outside-'))
    cleanup.push(insideDir, outsideDir)
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('app-open-files-by-id refuses a forged send with no granted root', async () => {
    const outsideFile = path.join(outsideDir, 'victim.md')
    writeFileSync(outsideFile, '# nope')

    const { editor } = makeApp({ openFilesInNewWindow: false })
    await drive('app-open-files-by-id', [outsideFile])

    expect(editor.openTabsFromPaths).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('app-open-files-by-id'),
      expect.anything(),
      expect.anything()
    )
  })

  it('app-open-files-by-id opens paths inside a granted root', async () => {
    const insideFile = path.join(insideDir, 'doc.md')
    writeFileSync(insideFile, '# yes')
    addAllowedRoot(insideDir)

    const { editor } = makeApp({ openFilesInNewWindow: false })
    await drive('app-open-files-by-id', [insideFile])

    expect(editor.openTabsFromPaths).toHaveBeenCalledWith([insideFile])
  })

  it('app-open-directory-by-id refuses a forged send with no granted root', async () => {
    const { editor } = makeApp({ openFolderInNewWindow: false })
    await drive('app-open-directory-by-id', outsideDir)

    expect(editor.openFolder).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('app-open-directory-by-id'),
      expect.anything(),
      expect.anything()
    )
  })

  it('app-open-directory-by-id opens a granted directory in the same window', async () => {
    addAllowedRoot(insideDir)

    const { editor } = makeApp({ openFolderInNewWindow: false })
    await drive('app-open-directory-by-id', insideDir)

    expect(editor.openFolder).toHaveBeenCalledWith(insideDir)
  })

  it('app-open-files-by-id ignores a forged non-array payload instead of throwing', async () => {
    const { editor } = makeApp({ openFilesInNewWindow: false })

    await expect(drive('app-open-files-by-id', 'not-a-list')).resolves.toBeUndefined()

    // Normalized to an empty list: the open path runs with zero entries
    // rather than the listener throwing on `.map` of a string.
    expect(editor.openTabsFromPaths).toHaveBeenCalledWith([])
    expect(log.warn).not.toHaveBeenCalled()
  })
})
