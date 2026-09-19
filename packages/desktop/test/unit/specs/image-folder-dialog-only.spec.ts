import { beforeEach, describe, expect, it, vi } from 'vitest'

// O7(1) — the image folder is the one preference that also grants write scope
// (`addAllowedRoot`), and until now a renderer could set it by sending a plain
// string through the generic preference channel. That is an escalation path: one
// XSS picks the folder, and every guarded `mt::fs::*` write may then land inside
// it. The folder must only ever be assigned by the main-process dialog.

const { onChannels, emitted, showOpenDialog } = vi.hoisted(() => ({
  onChannels: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  emitted: [] as unknown[][],
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/colamd-userdata' },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => ({ id: 1, webContents: { send: vi.fn() } })
  },
  dialog: { showOpenDialog },
  ipcMain: {
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      onChannels.set(channel, listener)
    },
    handle: vi.fn(),
    emit: vi.fn((...args: unknown[]) => {
      emitted.push(args)
    })
  },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' }
}))

vi.mock('electron-store', () => ({
  default: class {
    store: Record<string, unknown> = {}

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') this.store[key] = value
      else Object.assign(this.store, key)
    }

    get(key: string): unknown {
      return this.store[key]
    }

    delete(key: string): void {
      delete this.store[key]
    }
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: () => false,
    readFileSync: () => JSON.stringify({ theme: 'light' })
  }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('../../../src/main/config', () => ({ isWindows: false, isOsx: false, isLinux: true }))
vi.mock('common/filesystem', () => ({ ensureDirSync: vi.fn() }))

import Preference from '../../../src/main/preferences'
import DataCenter from '../../../src/main/dataCenter'
;(globalThis as unknown as { __static: string }).__static = '/tmp/colamd-static/'

const fire = (channel: string, ...args: unknown[]): unknown => {
  const listener = onChannels.get(channel)
  if (!listener) throw new Error(`nothing listens on ${channel}`)
  return listener({ sender: {} }, ...args)
}

const payloadOf = (channel: string): Record<string, unknown>[] =>
  emitted.filter(([name]) => name === channel).map(([, p]) => p as Record<string, unknown>)

describe('O7(1) — the image folder is dialog-assigned only', () => {
  beforeEach(() => {
    emitted.length = 0
    showOpenDialog.mockReset()
  })

  it('drops a renderer-forged imageFolderPath from the preference channel', () => {
    const preference = new Preference({ preferencesPath: '/tmp/colamd-prefs' })
    fire('mt::set-user-preference', { theme: 'dark', imageFolderPath: '/etc' })

    expect(preference.getItem<string>('theme')).toBe('dark')
    expect(preference.getItem('imageFolderPath')).toBeUndefined()
    const broadcasts = payloadOf('broadcast-preferences-changed')
    expect(broadcasts.length).toBe(1)
    expect(broadcasts[0]).toEqual({ theme: 'dark' })
  })

  it('asks the user through the dialog even when the renderer already sends a path', async() => {
    showOpenDialog.mockResolvedValue({ filePaths: ['/picked/by/user'] })
    const dataCenter = new DataCenter({
      dataCenterPath: '/tmp/colamd-datacenter',
      userDataPath: '/tmp/colamd-userdata'
    })

    await (fire('mt::ask-for-modify-image-folder-path', '/etc') as Promise<void>)

    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    expect(dataCenter.getItem('imageFolderPath')).toBe('/picked/by/user')
  })

  it('keeps the stored folder when the dialog is cancelled', async() => {
    showOpenDialog.mockResolvedValue({ filePaths: [] })
    const dataCenter = new DataCenter({
      dataCenterPath: '/tmp/colamd-datacenter',
      userDataPath: '/tmp/colamd-userdata'
    })
    const before = dataCenter.getItem('imageFolderPath')

    await (fire('mt::ask-for-modify-image-folder-path', '/etc') as Promise<void>)

    expect(dataCenter.getItem('imageFolderPath')).toBe(before)
  })
})
