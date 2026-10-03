import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return electronCaptureMock()
})

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
const { writeMarkdownFile } = await import('main_renderer/filesystem/markdown')

// Loading the module is what registers the mt::response-file-save funnel.
await import('main_renderer/menu/actions/file')

// mt::response-file-save is handleResponseForSave itself — the funnel every
// save path (response-file-save[-as], save-tabs) routes through. The audit
// found its renderer-provided `pathname` bypassed the pathScope gate that
// every other mutating fs channel goes through.

// The typedOn registrations happen once at module load — wiping the registry
// in afterEach would leave later tests without a handler, so only the path
// registry (a process-global) and the write spy get reset.
afterEach(() => {
  clearAllowedRootsForTest()
  vi.mocked(writeMarkdownFile).mockClear()
})

const driveSave = async (
  pathname: string
): Promise<{ result: unknown; send: ReturnType<typeof vi.fn> }> => {
  const handler = ipcRegistry.on.get('mt::response-file-save')
  if (!handler) throw new Error('mt::response-file-save not registered')
  const winMock = { webContents: { send: vi.fn() } }
  fromWebContentsMock.mockReturnValue(winMock)
  const result = await handler({ sender: {} }, 'tab-1', 'note.md', pathname, '# hello', {})
  return { result, send: winMock.webContents.send }
}

describe('mt::response-file-save scope gate', () => {
  it('refuses a renderer-provided pathname outside the allowed roots', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'save-scope-out-'))
    try {
      const { result, send } = await driveSave(path.join(outside, 'evil.md'))

      expect(result).toBeUndefined()
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      // Fails through the normal save-failure surface, not an unhandled throw.
      expect(send).toHaveBeenCalledWith(
        'mt::tab-save-failure',
        'tab-1',
        expect.stringContaining('scope')
      )
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('saves normally when the pathname sits inside a granted root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save-scope-in-'))
    try {
      addAllowedRoot(root)
      const { result, send } = await driveSave(path.join(root, 'note.md'))

      expect(result).toBe('tab-1')
      expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith('mt::tab-saved', 'tab-1')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
