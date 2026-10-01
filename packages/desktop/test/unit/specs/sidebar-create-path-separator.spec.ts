import type * as FileSystemModule from '@/util/fileSystem'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Characterization test, NOT a regression test for a fix.
//
// History: `CREATE_FILE_DIRECTORY` used to build its target as
// `${dirname}/${name}`, and PR #59 "fixed" it to
// `${dirname}${PATH_SEPARATOR}${name}` on the claim that a hardcoded slash
// produces a mixed path on Windows. **That fix was a no-op and the claim was
// wrong in every part.** Two facts, both verified:
//
//   1. `PATH_SEPARATOR` (renderer/src/config.ts) is `window.path.sep`, and the
//      preload exposes `sep: pathe.sep` (preload/index.ts:262). pathe is a
//      POSIX-style library: `pathe.sep === '/'` on EVERY platform. So the two
//      concatenations are byte-identical.
//   2. `dirname` is always pathe-canonical, never mixed. It comes from
//      `sidebarContextMenu.ts:34` — `isDirectory ? pathname : window.path.dirname(pathname)`
//      — and both arms are pathe: folder pathnames are built by `treeCtrl.ts:131`
//      as `${currentPath}${PATH_SEPARATOR}${dirName}` from a pathe-normalized
//      root, and `window.path.dirname` is pathe too. On Windows that is
//      `C:/docs`, forward slashes, no backslashes anywhere.
//
// So the slash was never the bug. The real mismatch is that the renderer's tree
// is pathe (forward slashes) while the main process's chokidar watcher emits
// NATIVE paths (backslashes on Windows) — those two meet at the bare `===` in
// `treeEvents.ts:38`, which is why a newly created markdown file is never
// adopted into a tab on Windows. That defect is real, is NOT fixed here, and
// belongs in its own batch.
//
// What this file does is pin the invariant that actually holds, so that a future
// change to native-separator joining (which would silently break every
// pathe-canonical comparison in the renderer) shows up here.
//
// Note the stub: `sep` MUST be '/'. An earlier draft of this spec stubbed it to
// '\\' — a value the real preload can never return — and that fiction is exactly
// what made the bogus fix look convincing (4 red, then 4 green).

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
  w.window.path ??= {
    // pathe.sep — '/' on every platform. Stubbing this to '\\' would be a lie.
    sep: '/',
    // pathe normalizes backslashes to forward slashes, so a native Windows path
    // handed to the renderer comes out forward-slashed.
    normalize: (p) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
    basename: (p) => p.split('/').filter(Boolean).pop() ?? p,
    dirname: (p) => {
      const parts = p.replace(/\\/g, '/').split('/')
      parts.pop()
      return parts.join('/')
    }
  }
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

const POSIX_DIR = '/docs'
const NATIVE_DIR = 'C:\\docs'

describe('CREATE_FILE_DIRECTORY builds pathe-canonical paths (characterization)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.fileUtils.pathExists = vi.fn(() => Promise.resolve(false))
  })

  it('joins a posix dirname with a slash', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: POSIX_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('fresh')

    expect(create).toHaveBeenCalledWith('/docs/fresh.md', 'file')
  })

  it('concatenates WITHOUT normalizing — the pathe form comes from sidebarContextMenu.ts:34', async () => {
    // Pins what this function actually does, which is plain concatenation. It
    // does NOT call `window.path.normalize`, so a native dirname handed to it
    // would yield a mixed path. That case does not occur because
    // `sidebarContextMenu.ts:34` derives `dirname` with pathe on both arms
    // (`isDirectory ? pathname : window.path.dirname(pathname)`) and folder
    // pathnames are pathe-joined in `treeCtrl.ts:131`.
    //
    // Asserting the absence of normalization is deliberate: if someone later adds
    // `normalize` here, the mixed-path shape disappears — which is a behaviour
    // change worth a look, not a silent improvement.
    const store = useProjectStore()
    store.createCache = { dirname: NATIVE_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('fresh')

    const target = vi.mocked(create).mock.calls[0]?.[0] as string
    // Unnormalized: the native dirname survives verbatim and gains one slash.
    expect(target).toBe('C:\\docs/fresh.md')
  })

  it('does not append .md for directories', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: POSIX_DIR, type: 'directory' }

    await store.CREATE_FILE_DIRECTORY('sub')

    expect(create).toHaveBeenCalledWith('/docs/sub', 'directory')
  })

  it('tests the conflict guard with the same string it would create (#1946)', async () => {
    window.fileUtils.pathExists = vi.fn(() => Promise.resolve(true))
    const store = useProjectStore()
    store.createCache = { dirname: POSIX_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('taken')

    // The guard must probe exactly the path that would be written, otherwise it
    // is protecting a different string than the one that gets created.
    expect(window.fileUtils.pathExists).toHaveBeenCalledWith('/docs/taken.md')
    expect(create).not.toHaveBeenCalled()
  })
})
