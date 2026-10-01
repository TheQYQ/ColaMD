import type * as FileSystemModule from '@/util/fileSystem'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `CREATE_FILE_DIRECTORY` builds the target path by concatenating, and the
// repository has both idioms side by side in that one file:
//
//   :209  const fullName = `${dirname}/${name}`          <- hardcoded slash
//   :240  const dest = dirname + PATH_SEPARATOR + name   <- the correct one
//
// `dirname` comes from a tree node (`sidebarContextMenu.ts:35`), and the tree
// root is passed through `window.path.normalize` (`project.ts:22`), so on
// Windows it carries BACKSLASHES. The watcher event that the renderer compares
// it against is produced by chokidar and is native too. So the hardcoded slash
// yields a MIXED path:
//
//   pendingNewFileName : C:\docs/fresh.md      (what the store publishes)
//   watcher pathname   : C:\docs\fresh.md      (what chokidar reports)
//
// and `treeEvents.ts:38` compares them with a bare `===`. That branch is what
// adopts the newly created markdown file into a tab, so on Windows the file is
// created but never adopted, and `newFileNameCache` is never cleared.
//
// The two existing specs on this behaviour cannot see it: `sidebar-create-conflict`
// stubs `sep: '/'` with a `/docs` dirname (so the hardcoded slash coincidentally
// matches), and `tree-events.spec.ts` feeds BOTH sides from the same
// `/root/new.md` literal. Both are structurally blind to a separator mismatch.
//
// This file therefore pins the Windows shape: `sep` is `'\\'` and the dirname is
// native, which is the only combination that distinguishes the two
// concatenations.

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
    // Windows shape. `@/config` reads `window.path.sep` at module scope, so this
    // has to be in place before the import graph is evaluated.
    sep: '\\',
    normalize: (p) => p.replace(/\//g, '\\'),
    basename: (p) => p.split(/[\\/]/).pop() ?? p,
    dirname: (p) => p.split(/[\\/]/).slice(0, -1).join('\\')
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

const WIN_DIR = 'C:\\docs'

describe('CREATE_FILE_DIRECTORY builds a native path on Windows (#1946 sibling)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.fileUtils.pathExists = vi.fn(() => Promise.resolve(false))
  })

  it('joins dirname and name with the platform separator, not a hardcoded slash', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: WIN_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('fresh')

    // Exactly one character distinguishes the two concatenations here: the
    // junction. A mixed path is what breaks the strict comparison in
    // `treeEvents.ts:38`.
    expect(create).toHaveBeenCalledWith('C:\\docs\\fresh.md', 'file')
  })

  it('joins with the platform separator for directories too', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: WIN_DIR, type: 'directory' }

    await store.CREATE_FILE_DIRECTORY('sub')

    // No `.md` is appended for directories, so the junction is the only
    // difference from the file case as well.
    expect(create).toHaveBeenCalledWith('C:\\docs\\sub', 'directory')
  })

  it('never emits a foreign separator alongside the native one', async () => {
    const store = useProjectStore()
    store.createCache = { dirname: WIN_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('mixed')

    const target = vi.mocked(create).mock.calls[0]?.[0] as string
    // `sep` is `\\` here, so a forward slash anywhere in the result means the
    // two concatenations got mixed — which is exactly what chokidar's native
    // path can never equal.
    expect(target).not.toContain('/')
    expect(target).toContain('\\')
  })

  it('keeps the conflict guard working with a native path (#1946)', async () => {
    window.fileUtils.pathExists = vi.fn(() => Promise.resolve(true))
    const store = useProjectStore()
    store.createCache = { dirname: WIN_DIR, type: 'file' }

    await store.CREATE_FILE_DIRECTORY('taken')

    // The guard must test the SAME string it would create, separator and all.
    expect(window.fileUtils.pathExists).toHaveBeenCalledWith('C:\\docs\\taken.md')
    expect(create).not.toHaveBeenCalled()
  })
})
