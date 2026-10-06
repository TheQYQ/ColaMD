import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
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

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return {
    ...electronCaptureMock(),
    app: { getPath: () => state.userDataDir }
  }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key, setLanguage: vi.fn() }))
vi.mock('../../../src/main/menu/actions/file', () => ({
  openFileOrFolder: vi.fn()
}))

import log from 'electron-log'
import { fromWebContentsMock, ipcRegistry, resetIpcRegistry } from '../mainHandlerHarness'
import { openFileOrFolder } from '../../../src/main/menu/actions/file'
import { registerMenuHandlers } from '../../../src/main/ipc/menu'
import { RECENTLY_USED_DOCUMENTS_FILE_NAME } from '../../../src/main/utils/recentDocuments'

const drive = (channel: string, payload: unknown): void => {
  const handler = ipcRegistry.on.get(channel)
  if (!handler) throw new Error(`no ipcMain.on registered for "${channel}"`)
  handler({ sender: {} }, payload)
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
