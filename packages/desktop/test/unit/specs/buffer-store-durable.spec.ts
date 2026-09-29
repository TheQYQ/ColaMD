import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The store registers ipcMain handlers in its constructor; stub electron so the
// module imports without a real main process. writeBufferStoreFile no longer
// touches `this`, so we exercise it via the prototype without booting the store.
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ restoreBufferId: 'buffer-under-test' })
  }
}))

const { default: EditorBufferStore } = await import('main_renderer/editorBufferStore')

// #4852 follow-up: the crash-recovery buffer holds unsaved tab content but used
// a temp+rename with no fsync — the same power-loss zero-fill gap the document
// save path had. writeBufferStoreFile now writes durably via write-file-atomic.
const writeBufferStoreFile = EditorBufferStore.prototype.writeBufferStoreFile
// #26 item 2: the same write used to swallow its own error and the handler
// returned `true` regardless, so the renderer kept believing the snapshot was
// on disk. Both halves are pinned below.
const updateBufferState = EditorBufferStore.prototype.updateBufferState

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'mt-buf-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('EditorBufferStore.writeBufferStoreFile — durable atomic write (#4852 follow-up)', () => {
  it('writes the state as JSON and leaves no temp file behind', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'buffer.json')
    const state = { tabs: [{ id: '1', markdown: 'hello' }] }

    await writeBufferStoreFile(target, state)

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(state)
    // The temp file was renamed over the target — nothing left in the dir.
    expect(readdirSync(dir)).toEqual(['buffer.json'])
  })

  it('overwrites an existing buffer file', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'buffer.json')

    await writeBufferStoreFile(target, { tabs: ['old'] })
    await writeBufferStoreFile(target, { tabs: ['new'] })

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ tabs: ['new'] })
    expect(readdirSync(dir)).toEqual(['buffer.json'])
  })

  // M1.4: writes left the main-process sync path. Two rapid writes for the
  // same file must still land in call order — an older snapshot may never
  // overwrite a newer one.
  it('serializes rapid writes per file (last write wins)', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'buffer.json')

    const first = writeBufferStoreFile(target, { seq: 1 })
    const second = writeBufferStoreFile(target, { seq: 2 })
    await Promise.all([first, second])

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ seq: 2 })
    expect(readdirSync(dir)).toEqual(['buffer.json'])
  })
})

describe('the crash buffer reports what actually happened (#26 item 2)', () => {
  it('reports success as a value the caller can trust', async () => {
    const target = path.join(tempDir(), 'buffer.json')
    expect(await writeBufferStoreFile(target, { tabs: [] })).toBe(true)
  })

  it('reports failure instead of resolving as if the write had landed', async () => {
    const blocked = path.join(tempDir(), 'buffer.json')
    mkdirSync(blocked)

    expect(await writeBufferStoreFile(blocked, { tabs: ['unsaved'] })).toBe(false)
  })

  it('writes again after a failed write for the same file', async () => {
    // The queue link must not carry a rejection forward, or one failure would
    // silently freeze every later snapshot for that window.
    const blocked = path.join(tempDir(), 'buffer.json')
    mkdirSync(blocked)
    expect(await writeBufferStoreFile(blocked, { seq: 1 })).toBe(false)
    rmSync(blocked, { recursive: true, force: true })

    expect(await writeBufferStoreFile(blocked, { seq: 2 })).toBe(true)
    expect(JSON.parse(readFileSync(blocked, 'utf8'))).toEqual({ seq: 2 })
  })

  it('the invoke handler answers with the write result, not with `true`', async () => {
    const dir = tempDir()
    // Only `sender` is read, and the electron stub resolves it to a window that
    // carries a `restoreBufferId`.
    const event = { sender: {} } as unknown as Parameters<typeof updateBufferState>[0]
    const stub = (filePath: string) => ({
      getBufferStoreInfo: () => ({ filePath }),
      writeBufferStoreFile
    })
    const good = path.join(dir, 'buffer.json')
    expect(await updateBufferState.call(stub(good), event, { tabs: ['a'] })).toBe(true)

    const blocked = path.join(dir, 'blocked.json')
    mkdirSync(blocked)
    expect(await updateBufferState.call(stub(blocked), event, { tabs: ['b'] })).toBe(false)
  })
})
