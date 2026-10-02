import type * as FileSystemModule from '@/util/fileSystem'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Same stub surface as sidebar-create-conflict.spec.ts: `@/store/project`
// reaches window.path (via @/config) and window.fileUtils at runtime.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        normalize: (p: string) => string
        basename: (p: string) => string
        dirname: (p: string) => string
      }
      fileUtils?: {
        hasMarkdownExtension: (n: string) => boolean
        pathExists: (p: string) => Promise<boolean>
      }
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', normalize: (p) => p, basename: (p) => p, dirname: (p) => p }
  w.window.fileUtils ??= {
    hasMarkdownExtension: (n: string) => n.endsWith('.md'),
    pathExists: () => Promise.resolve(false)
  }
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

vi.mock('@/util/fileSystem', async (orig) => {
  const actual = await orig<typeof FileSystemModule>()
  return { ...actual, create: vi.fn(() => Promise.resolve()) }
})

import { useProjectStore } from '@/store/project'
import { create } from '@/util/fileSystem'

// The create dialog's cache must survive an older create request settling
// late (#PathScopeless-createCache race): SIDEBAR::new replaces the cache
// object every time a dialog opens, so identity comparison tells which
// request still owns it.
describe('CREATE_FILE_DIRECTORY — cache ownership across dialog reopen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Restore the default stub: a test that replaces pathExists with a
    // deferred must not hang the tests after it.
    window.fileUtils.pathExists = () => Promise.resolve(false)
    // clearAllMocks keeps implementations — a deferred-installing
    // mockImplementation from an earlier test would leak into this one.
    vi.mocked(create).mockImplementation(() => Promise.resolve())
  })

  // CREATE_FILE_DIRECTORY only calls `create` after its `await pathExists`
  // resumes, which happens in a later microtask than the submit call. Yield
  // once so the deferred resolver exists before the test drives it.
  const flush = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })

  it('keeps the newer dialog cache when an older create settles late (success path)', async () => {
    let resolveCreate!: (v: void) => void
    vi.mocked(create).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve
        })
    )
    const store = useProjectStore()
    store.createCache = { dirname: '/docs', type: 'file' }
    const pending = store.CREATE_FILE_DIRECTORY('a')
    await flush()

    // A second dialog opens while the first create is still in flight.
    store.createCache = { dirname: '/other', type: 'file' }
    const cacheB = store.createCache

    resolveCreate()
    await pending

    expect(store.createCache).toBe(cacheB)
  })

  it('keeps the newer dialog cache when an older conflict check settles late', async () => {
    let resolvePathExists!: (v: boolean) => void
    window.fileUtils.pathExists = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePathExists = resolve
        })
    )
    const store = useProjectStore()
    store.createCache = { dirname: '/docs', type: 'file' }
    const pending = store.CREATE_FILE_DIRECTORY('a')
    await flush()

    store.createCache = { dirname: '/other', type: 'file' }
    const cacheB = store.createCache

    resolvePathExists(true)
    await pending

    expect(store.createCache).toBe(cacheB)
  })

  it('still clears the cache when no newer dialog opened (positive control)', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: '/docs', type: 'file' }

    await store.CREATE_FILE_DIRECTORY('fresh')

    expect(store.createCache).toEqual({})
    expect(create).toHaveBeenCalledWith('/docs/fresh.md', 'file')
  })

  it('still adopts the created file even when a newer dialog is open', async () => {
    let resolveCreate!: (v: void) => void
    vi.mocked(create).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve
        })
    )
    const store = useProjectStore()
    store.createCache = { dirname: '/docs', type: 'file' }
    const pending = store.CREATE_FILE_DIRECTORY('a')
    await flush()

    store.createCache = { dirname: '/other', type: 'file' }
    resolveCreate()
    await pending

    expect(store.newFileNameCache).toBe('/docs/a.md')
  })
})
