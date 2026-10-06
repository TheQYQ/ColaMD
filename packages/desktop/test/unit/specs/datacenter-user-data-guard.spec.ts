import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return electronCaptureMock()
})

// A plain map backend: the key allow-list is under test, not conf itself.
vi.mock('electron-store', () => {
  class Store {
    private map = new Map<string, unknown>()
    set(keyOrObject: string | Record<string, unknown>, value?: unknown): void {
      if (typeof keyOrObject === 'string') {
        this.map.set(keyOrObject, value)
      } else {
        for (const [k, v] of Object.entries(keyOrObject)) this.map.set(k, v)
      }
    }

    get(key: string): unknown {
      return this.map.get(key)
    }

    get store(): Record<string, unknown> {
      return Object.fromEntries(this.map)
    }
  }
  return { default: Store }
})

const { ipcRegistry } = await import('../mainHandlerHarness')
const { default: DataCenter } = await import('main_renderer/dataCenter')
const { ipcMain } = await import('electron')

// mt::set-user-data used to be a bare pass-through to setItems, so a
// compromised renderer could assign imageFolderPath — the key App registers
// with addAllowedRoot via the broadcast-user-data-changed listener — and
// screenshotFolderPath, whose write path runs ensureDirSync. The only
// legitimate renderer write for this store is currentUploader
// (prefComponents/image/.../uploader/index.vue), so the handler allow-lists.

const dirs: string[] = []
const tempDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'datacenter-guard-'))
  dirs.push(d)
  return d
}

const makeDataCenter = (): InstanceType<typeof DataCenter> => {
  const dir = tempDir()
  return new DataCenter({ dataCenterPath: dir, userDataPath: dir })
}

const invokeSetUserData = async (userData: Record<string, unknown>): Promise<void> => {
  const handler = ipcRegistry.on.get('mt::set-user-data')
  if (!handler) throw new Error('mt::set-user-data not registered')
  await handler({ sender: {} }, userData)
}

const broadcastCalls = (): unknown[][] =>
  vi.mocked(ipcMain.emit).mock.calls.filter((c) => c[0] === 'broadcast-user-data-changed')

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  vi.mocked(ipcMain.emit).mockClear()
})

describe('mt::set-user-data key allow-list', () => {
  it('rejects imageFolderPath and does not broadcast it (the broadcast is the scope grant)', async () => {
    const dc = makeDataCenter()
    const before = dc.getItem('imageFolderPath')

    await invokeSetUserData({ imageFolderPath: path.join(os.tmpdir(), 'evil-root') })

    expect(dc.getItem('imageFolderPath')).toBe(before)
    expect(broadcastCalls()).toEqual([])
  })

  it('rejects screenshotFolderPath so the renderer cannot redirect the mkdir/write target', async () => {
    const dc = makeDataCenter()
    const before = dc.getItem('screenshotFolderPath')

    await invokeSetUserData({ screenshotFolderPath: path.join(os.tmpdir(), 'evil-shots') })

    expect(dc.getItem('screenshotFolderPath')).toBe(before)
    expect(broadcastCalls()).toEqual([])
  })

  it('accepts currentUploader — the one renderer-owned key — and broadcasts it', async () => {
    const dc = makeDataCenter()

    await invokeSetUserData({ currentUploader: 'custom-picgo' })

    expect(dc.getItem('currentUploader')).toBe('custom-picgo')
    expect(broadcastCalls()).toEqual([
      ['broadcast-user-data-changed', { currentUploader: 'custom-picgo' }]
    ])
  })
})
