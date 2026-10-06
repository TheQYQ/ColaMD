import path from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Batch C — mt::ask-for-image-auto-path: the renderer controls `src` (and
// `pathname`), the handler derives a directory from them and calls
// searchFilesAndDir, which fs.readdir's it, caches the entries AND spawns an
// fs.watch per directory. Without a scope check a forged send enumerates any
// directory on disk and grows an unbounded watcher set. Legit callers send
// the current document (its dirname is granted at open) or the configured
// image folder (granted at startup), so the gate costs them nothing.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return { ...electronCaptureMock() }
})
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('main_renderer/commands', () => ({
  COMMANDS: new Proxy({}, { get: (_t, name: string | symbol) => String(name) })
}))
vi.mock('main_renderer/utils/imagePathAutoComplement', () => ({
  searchFilesAndDir: vi.fn(async () => []),
  watchers: new Map()
}))

import log from 'electron-log'
import { fromWebContentsMock } from '../mainHandlerHarness'
import { searchFilesAndDir } from '../../../src/main/utils/imagePathAutoComplement'
import { addAllowedRoot, clearAllowedRootsForTest } from '../../../src/main/security/pathScope'
import '../../../src/main/menu/actions/edit'

type SendSpy = ReturnType<typeof vi.fn>

const drive = async (payload: Record<string, unknown>): Promise<void> => {
  const handler = (await import('../mainHandlerHarness')).ipcRegistry.on.get(
    'mt::ask-for-image-auto-path'
  )
  if (!handler) {
    throw new Error('no ipcMain.on registered for "mt::ask-for-image-auto-path"')
  }
  await handler({ sender: {} }, payload)
}

describe('mt::ask-for-image-auto-path is scoped', () => {
  let docDir = ''
  const cleanup: string[] = []
  let send: SendSpy

  beforeEach(() => {
    // No resetIpcRegistry here: the handler registers once at module import,
    // and clearing the registry would drop it for every later test.
    clearAllowedRootsForTest()
    vi.mocked(log.warn).mockClear()
    vi.mocked(searchFilesAndDir).mockClear().mockResolvedValue([])
    docDir = mkdtempSync(path.join(tmpdir(), 'colamd-imgdoc-'))
    cleanup.push(docDir)
    send = vi.fn()
    fromWebContentsMock.mockReturnValue({ id: 3, webContents: { send } })
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to enumerate a directory outside the granted roots', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'colamd-imgout-'))
    cleanup.push(outsideDir)

    await drive({
      pathname: path.join(docDir, 'doc.md'),
      src: outsideDir + path.sep,
      id: 'req-1'
    })

    expect(searchFilesAndDir).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('mt::response-of-image-path-req-1', [])
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('mt::ask-for-image-auto-path'),
      expect.anything(),
      expect.anything()
    )
  })

  it('enumerates the document directory when it is granted', async () => {
    addAllowedRoot(docDir)
    const hits = [{ file: 'shot.png', type: 'image' }]
    vi.mocked(searchFilesAndDir).mockResolvedValue(hits)

    await drive({
      pathname: path.join(docDir, 'doc.md'),
      src: 'shot',
      id: 'req-2'
    })

    expect(searchFilesAndDir).toHaveBeenCalledWith(docDir, 'shot')
    expect(send).toHaveBeenCalledWith('mt::response-of-image-path-req-2', hits)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('replies empty for a missing src without touching the filesystem', async () => {
    await drive({ pathname: path.join(docDir, 'doc.md'), src: '', id: 'req-3' })

    expect(searchFilesAndDir).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('mt::response-of-image-path-req-3', [])
  })

  it('refuses a forged payload without a pathname instead of throwing', async () => {
    await expect(drive({ src: 'anything.png', id: 'req-4' })).resolves.toBeUndefined()

    expect(searchFilesAndDir).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('mt::response-of-image-path-req-4', [])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('mt::ask-for-image-auto-path'))
  })
})
