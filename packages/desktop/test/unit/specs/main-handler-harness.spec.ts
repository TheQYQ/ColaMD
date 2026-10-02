import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Batch C of the repair plan: the main-process handler layer (typedHandle /
// typedOn registrations) had no test scaffolding — a handler's behavior was
// reachable only by booting Electron. This spec drives two real main modules
// through the captured registration surface to prove the harness works.

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return electronCaptureMock()
})

const { ipcRegistry, invokeHandle, makeInvokeEvent, fromWebContentsMock, resetIpcRegistry } =
  await import('../mainHandlerHarness')

const dirs: string[] = []
const tempDir = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'main-handler-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  resetIpcRegistry()
})

const SPELLCHECKER_CHANNELS = [
  'mt::spellchecker-remove-word',
  'mt::spellchecker-switch-language',
  'mt::spellchecker-get-available-dictionaries',
  'mt::spellchecker-set-enabled',
  'mt::spellchecker-get-custom-dictionary-words'
]

describe('mainHandlerHarness — real main modules driven at the handler layer', () => {
  it('captures the five spellchecker channels and drives remove-word / get-words', async () => {
    const spellchecker = await import('main_renderer/spellchecker')
    spellchecker.default()

    for (const channel of SPELLCHECKER_CHANNELS) {
      expect(ipcRegistry.handle.has(channel), channel).toBe(true)
    }

    const session = {
      removeWordFromSpellCheckerDictionary: vi.fn(() => true),
      listWordsInSpellCheckerDictionary: vi.fn(async () => ['alpha', 'beta'])
    }
    fromWebContentsMock.mockReturnValue({ webContents: { session } })

    await expect(
      invokeHandle('mt::spellchecker-remove-word', makeInvokeEvent(), 'alpha')
    ).resolves.toBe(true)
    expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith('alpha')

    await expect(
      invokeHandle('mt::spellchecker-get-custom-dictionary-words', makeInvokeEvent())
    ).resolves.toEqual(['alpha', 'beta'])
  })

  it('spellchecker handlers answer a dead window without throwing', async () => {
    const spellchecker = await import('main_renderer/spellchecker')
    spellchecker.default()
    fromWebContentsMock.mockReturnValue(null)

    await expect(
      invokeHandle('mt::spellchecker-remove-word', makeInvokeEvent(), 'alpha')
    ).resolves.toBe(false)
    await expect(
      invokeHandle('mt::spellchecker-get-custom-dictionary-words', makeInvokeEvent())
    ).resolves.toEqual([])
  })

  it('drives the editorBufferStore update handler end to end through its registration', async () => {
    const { default: EditorBufferStore } = await import('main_renderer/editorBufferStore')
    const dir = tempDir()
    fromWebContentsMock.mockReturnValue({ restoreBufferId: 'buffer-under-test' })

    // Booting the constructor is what registers the handler under test; the
    // instance itself is intentionally unused (the drive goes through the
    // captured ipcMain.handle surface).
    const _store = new EditorBufferStore({ editorBufferStorePath: dir })
    expect(ipcRegistry.handle.has('update-buffer-state')).toBe(true)

    const state = { tabs: [{ id: '1', markdown: 'hello' }] }
    await expect(invokeHandle('update-buffer-state', makeInvokeEvent(), state)).resolves.toBe(true)
    const written = path.join(dir, 'buffer-under-test_editor_buffer_store.json')
    expect(existsSync(written)).toBe(true)
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual(state)
  })

  it('update-buffer-state reports false at the handler layer when the write cannot land', async () => {
    const { default: EditorBufferStore } = await import('main_renderer/editorBufferStore')
    const dir = tempDir()
    fromWebContentsMock.mockReturnValue({ restoreBufferId: 'buffer-under-test' })

    const _store = new EditorBufferStore({ editorBufferStorePath: dir })
    // The buffer file path is occupied by a directory, so the durable write
    // fails and the handler must report that honestly (#26 item 2).
    const occupied = path.join(dir, 'buffer-under-test_editor_buffer_store.json')
    const { mkdirSync } = await import('fs')
    mkdirSync(occupied)

    await expect(
      invokeHandle('update-buffer-state', makeInvokeEvent(), { tabs: [] })
    ).resolves.toBe(false)
  })
})
