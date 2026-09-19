import { beforeEach, describe, expect, it, vi } from 'vitest'
import Preference from '../../../src/main/preferences'
import DataCenter from '../../../src/main/dataCenter'

// Listeners merge the broadcast payload over `preferences.getAll()`, so a bulk
// update does not need one event per key — but `setItems` used to loop over
// `setItem`, waking every subscriber once per changed key. A two-key update
// that touches `theme` therefore rebuilt the native menu twice.

const emitted: unknown[][] = []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  ipcMain: {
    on: vi.fn(),
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
    // `init()` reads the defaults JSON from `global.__static`; a one-key file is
    // enough to exercise the merge path without a real static directory.
    readFileSync: () => JSON.stringify({ theme: 'light' })
  }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('../../../src/main/config', () => ({ isWindows: false, isOsx: false, isLinux: true }))
vi.mock('common/filesystem', () => ({
  ensureDirSync: vi.fn(),
  isFile2: () => true,
  isDirectory2: () => true
}))

// Set by main/globalSetting.ts in the app; the constructor needs it for staticPath.
;(globalThis as unknown as { __static: string }).__static = '/tmp/colamd-static/'

const broadcasts = (channel = 'broadcast-preferences-changed'): Array<Record<string, unknown>> =>
  emitted
    .filter(([name]) => name === channel)
    .map(([, payload]) => payload as Record<string, unknown>)

describe('preference change broadcast', () => {
  let preference: Preference

  beforeEach(() => {
    emitted.length = 0
    preference = new Preference({ preferencesPath: '/tmp/colamd-prefs' })
    emitted.length = 0
  })

  it('sends one merged event for a bulk update', () => {
    preference.setItems({ theme: 'dark', autoSave: true, language: 'zh-CN' })

    expect(broadcasts()).toEqual([{ theme: 'dark', autoSave: true, language: 'zh-CN' }])
  })

  it('still sends a single-key event for setItem', () => {
    preference.setItem('theme', 'dark')

    expect(broadcasts()).toEqual([{ theme: 'dark' }])
  })

  it('sends nothing when there is nothing to change', () => {
    preference.setItems(null)

    expect(broadcasts()).toEqual([])
  })
})

// Same loop, same fix, second store: this one forwards the payload straight to
// every window, so a merged object is what the renderer ends up needing.
describe('data center change broadcast', () => {
  let dataCenter: DataCenter

  beforeEach(() => {
    emitted.length = 0
    dataCenter = new DataCenter({
      dataCenterPath: '/tmp/colamd-datacenter',
      userDataPath: '/tmp/colamd-user'
    })
    emitted.length = 0
  })

  it('sends one merged event for a bulk update', () => {
    dataCenter.setItems({ imageFolderPath: '/tmp/colamd-user/images', currentUploader: 'picgo' })

    expect(broadcasts('broadcast-user-data-changed')).toEqual([
      { imageFolderPath: '/tmp/colamd-user/images', currentUploader: 'picgo' }
    ])
  })
})
