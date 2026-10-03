import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { electronCaptureMock } = await import('../mainHandlerHarness')
  return electronCaptureMock()
})

// A plain map backend: the quarantine wiring is under test, not conf itself.
vi.mock('electron-store', () => {
  class Store {
    private map = new Map<string, unknown>()
    // conf's set takes either (key, value) or one defaults object — init()
    // seeds via the object form.
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

const { default: DataCenter } = await import('main_renderer/dataCenter')

// Before the fix a corrupt dataCenter.json threw from the Store constructor
// and crash-looped every launch — the preferences store got a quarantine
// self-heal for the same failure mode, dataCenter now reuses it.

const dirs: string[] = []
const tempDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'datacenter-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('dataCenter corruption self-heal', () => {
  it('quarantines a corrupt dataCenter.json and boots from defaults', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'dataCenter.json'), '{ imageFolder', 'utf8')

    let dc: InstanceType<typeof DataCenter> | undefined
    expect(() => {
      dc = new DataCenter({ dataCenterPath: dir, userDataPath: dir })
    }).not.toThrow()

    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('dataCenter.json.corrupt-'))
    expect(backups).toHaveLength(1)

    // No usable file remained, so init() seeded the defaults.
    expect(dc?.hasDataCenterFile).toBe(false)
    expect(dc?.getItem('imageFolderPath')).toBe(path.join(dir, 'images'))
  })

  it('leaves a valid dataCenter.json in place', () => {
    const dir = tempDir()
    fs.writeFileSync(
      path.join(dir, 'dataCenter.json'),
      JSON.stringify({ currentUploader: 'picgo' }),
      'utf8'
    )

    const dc = new DataCenter({ dataCenterPath: dir, userDataPath: dir })

    expect(dc.hasDataCenterFile).toBe(true)
    expect(fs.existsSync(path.join(dir, 'dataCenter.json'))).toBe(true)
  })
})
