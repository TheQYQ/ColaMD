import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Batch B — mt::menu::open-path: openFileOrFolder is a trusted grant site
// (it addAllowedRoots the target), but this channel accepted any string.
// Legitimate sends echo back exactly what main itself put in
// recently-used-documents.json (mt::menu::get-recent-documents), so the
// recents list is the authorization for this channel. Cross-session recents
// are intentionally outside the current pathScope assert — that is why the
// gate is the list itself.
//
// Not gated yet (residual, recorded in the inventory): `menu-add-recently-used`
// can plant a forged path into the recents list first; it is main-owned state
// written from a save flow and belongs to a later batch.
//   → closed by batch D (see the second describe below): the add handler now
//     asserts pathScope, and the channel left IpcSendChannels.

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return {
    ...electronCaptureMock(),
    app: { getPath: () => state.userDataDir, addRecentDocument: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn(), getApplicationMenu: vi.fn() }
  }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
// Both '../i18n' (ipc/menu.ts) and '../i18n.js' (menu/index.ts) resolve to
// this one module — a single mock must satisfy both importers.
vi.mock('main_renderer/i18n.js', () => ({ t: (key: string) => key, setLanguage: vi.fn() }))
vi.mock('main_renderer/menu/actions/edit', () => ({ updateSidebarMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/format', () => ({ updateFormatMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/paragraph', () => ({ updateSelectionMenus: vi.fn() }))
vi.mock('main_renderer/menu/actions/view', () => ({ viewLayoutChanged: vi.fn() }))
vi.mock('main_renderer/menu/templates', () => ({
  default: vi.fn(() => []),
  configSettingMenu: vi.fn(() => [])
}))
vi.mock('../../../src/main/menu/actions/file', () => ({
  openFileOrFolder: vi.fn()
}))

import log from 'electron-log'
import { app } from 'electron'
import { fromWebContentsMock, ipcRegistry, resetIpcRegistry } from '../mainHandlerHarness'
import { openFileOrFolder } from '../../../src/main/menu/actions/file'
import { registerMenuHandlers } from '../../../src/main/ipc/menu'
import AppMenu from '../../../src/main/menu/index'
import { isOsx } from '../../../src/main/config'
import { addAllowedRoot, clearAllowedRootsForTest } from '../../../src/main/security/pathScope'
import { RECENTLY_USED_DOCUMENTS_FILE_NAME } from '../../../src/main/utils/recentDocuments'

const drive = (channel: string, payload: unknown): void => {
  const handler = ipcRegistry.on.get(channel)
  if (!handler) throw new Error(`no ipcMain.on registered for "${channel}"`)
  handler({ sender: {} }, payload)
}

// The add channel is onInternalChannel: main's own emitters call
// `ipcMain.emit(channel, path)` (payload only), while a renderer send reaches
// the same listener as (event, payload) — there is no signature adaptation.
const driveAdd = async (...args: unknown[]): Promise<void> => {
  const handler = ipcRegistry.on.get('menu-add-recently-used')
  if (!handler) throw new Error('no ipcMain.on registered for "menu-add-recently-used"')
  await handler(...args)
}

describe('mt::menu::open-path only opens recents', () => {
  let userDataDir = ''
  let existingFile = ''
  let sendSpy: ReturnType<typeof vi.fn>
  const cleanup: string[] = []

  beforeEach(() => {
    resetIpcRegistry()
    vi.mocked(log.warn).mockClear()
    vi.mocked(openFileOrFolder).mockClear()
    sendSpy = vi.fn()
    fromWebContentsMock.mockReturnValue({ id: 1, webContents: { send: sendSpy } })
    userDataDir = mkdtempSync(path.join(tmpdir(), 'colamd-recents-'))
    state.userDataDir = userDataDir
    cleanup.push(userDataDir)
    existingFile = path.join(userDataDir, 'doc.md')
    writeFileSync(existingFile, '# doc')
    registerMenuHandlers()
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const writeRecents = (entries: string[]): void => {
    writeFileSync(
      path.join(userDataDir, RECENTLY_USED_DOCUMENTS_FILE_NAME),
      JSON.stringify(entries, null, 2),
      'utf-8'
    )
  }

  it('refuses an existing path that is not in the recents list', () => {
    writeRecents([])

    drive('mt::menu::open-path', existingFile)

    expect(openFileOrFolder).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(existingFile))
    expect(sendSpy).toHaveBeenCalledWith(
      'mt::show-notification',
      expect.objectContaining({ type: 'error', title: 'dialog.openFailure' })
    )
  })

  it('opens a path that is in the recents list', () => {
    writeRecents([existingFile])

    drive('mt::menu::open-path', existingFile)

    expect(openFileOrFolder).toHaveBeenCalledTimes(1)
    expect(openFileOrFolder).toHaveBeenCalledWith(expect.anything(), existingFile)
  })

  it('lets a vanished entry fall through to the open failure path', () => {
    const dead = path.join(userDataDir, 'gone.md')
    writeFileSync(dead, '# gone')
    writeRecents([dead])
    unlinkSync(dead)

    drive('mt::menu::open-path', dead)

    // The reader drops missing entries, but openFileOrFolder owns the
    // "file was removed" notification for exactly this race — refusing
    // earlier would turn it into silence.
    expect(openFileOrFolder).toHaveBeenCalledWith(expect.anything(), dead)
  })

  it('opens a directory listed in recents', () => {
    const dir = path.join(userDataDir, 'folder')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'x'), 'x')
    writeRecents([dir])

    drive('mt::menu::open-path', dir)

    expect(openFileOrFolder).toHaveBeenCalledWith(expect.anything(), dir)
  })
})

// Batch D — menu-add-recently-used: main-owned state, but registered on plain
// ipcMain.on, so a renderer send reaches the listener (event-first — no
// signature adaptation) and the membership gate of mt::menu::open-path would
// then authorize whatever got planted. The add handler asserts pathScope:
// legit emitters are main's save flows, whose write target is already in
// scope (or dialog-granted) by the time the write succeeds.
describe('menu-add-recently-used is scoped', () => {
  let userDataDir = ''
  let recentsFile = ''
  const cleanup: string[] = []

  beforeEach(() => {
    resetIpcRegistry()
    clearAllowedRootsForTest()
    vi.mocked(log.warn).mockClear()
    userDataDir = mkdtempSync(path.join(tmpdir(), 'colamd-recents-plant-'))
    state.userDataDir = userDataDir
    cleanup.push(userDataDir)
    recentsFile = path.join(userDataDir, RECENTLY_USED_DOCUMENTS_FILE_NAME)
    // The add channel is registered by AppMenu._listenForIpcMain (the
    // constructor runs it), not by registerMenuHandlers.
    const _appMenu = new AppMenu({ getItem: () => 'en' } as never, {} as never, userDataDir)
    expect(_appMenu.RECENTS_PATH).toBe(recentsFile)
  })

  afterEach(() => {
    clearAllowedRootsForTest()
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const recorded = (): string[] =>
    existsSync(recentsFile) ? (JSON.parse(readFileSync(recentsFile, 'utf-8')) as string[]) : []

  it('refuses a renderer-shaped send (event-first) instead of planting the event', async () => {
    await driveAdd({ sender: {} }, path.join(userDataDir, 'forged.md'))

    expect(existsSync(recentsFile)).toBe(false)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('menu-add-recently-used'),
      expect.anything(),
      expect.anything()
    )
  })

  it('refuses an out-of-scope path on the internal (payload-first) shape', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'colamd-recents-out-'))
    cleanup.push(outside)
    const planted = path.join(outside, 'planted.md')
    writeFileSync(planted, '# p')

    await driveAdd(planted)

    expect(recorded()).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('menu-add-recently-used'),
      planted,
      expect.anything()
    )
  })

  it('still records an in-scope path (the legit save flow)', async () => {
    const inScope = path.join(userDataDir, 'saved.md')
    writeFileSync(inScope, '# s')
    addAllowedRoot(userDataDir)

    await driveAdd(inScope)

    // macOS hands recents to the OS (app.addRecentDocument) and returns before
    // the JSON write (menu/index.ts addRecentlyUsedDocument); win/linux write
    // recently-used-documents.json here.
    if (isOsx) {
      expect(app.addRecentDocument).toHaveBeenCalledWith(inScope)
    } else {
      expect(recorded()).toEqual([inScope])
    }
    expect(log.warn).not.toHaveBeenCalled()
  })
})
