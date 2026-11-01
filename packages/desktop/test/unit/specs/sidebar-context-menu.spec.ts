import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sidebar's right-click wiring was lifted out of `store/project.ts`'s setup
// into `store/sidebarContextMenu.ts` to take that setup off the length gate's
// binder. The move is only safe if every entry still lands on the same refs and
// the same IPC calls, so each one is asserted here -- including the Paste entry,
// which is registered by delegation and would silently disappear in a bad move.

type NotifyOpts = {
  title?: string
  type?: string
  message?: string
  showConfirm?: boolean
  time?: number
}

const h = vi.hoisted(() => {
  const handlers = new Map<string, (arg?: unknown) => unknown>()
  const notifications: NotifyOpts[] = []
  // The real service signals the user's choice by settling the promise it
  // returns: the confirm click resolves, the close button rejects, a timeout
  // never settles. The delete path hangs off that settlement, so the stub has
  // to hand the test the same two levers instead of a callback option.
  const settles: Array<{ resolve: () => void; reject: () => void }> = []
  return {
    handlers,
    notifications,
    settles,
    emitted: [] as string[],
    paste: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(),
    invoke: vi.fn()
  }
})

vi.mock('../../../src/renderer/src/bus', () => ({
  default: {
    on: (name: string, fn: (arg?: unknown) => unknown) => h.handlers.set(name, fn),
    emit: (name: string) => h.emitted.push(name)
  }
}))
vi.mock('../../../src/renderer/src/services/notification', () => ({
  default: {
    notify: (n: NotifyOpts): Promise<void> =>
      new Promise((resolve, reject) => {
        h.notifications.push(n)
        h.settles.push({ resolve, reject })
      })
  }
}))
vi.mock('../../../src/renderer/src/util/fileSystem', () => ({
  paste: h.paste
}))
vi.mock('../../../src/renderer/src/config', () => ({ PATH_SEPARATOR: '/' }))

import { registerSidebarContextMenuHandlers } from '../../../src/renderer/src/store/sidebarContextMenu'

const activeItem = {
  value: { pathname: '/proj/docs', isDirectory: true }
}
const createCache = { value: {} as Record<string, never> | { dirname: string; type: string } }
const clipboard = { value: null as null | { type: string; src: string; dest?: string } }
const renameCache = { value: null as string | null }

const fire = async (name: string, arg?: unknown): Promise<void> => {
  const handler = h.handlers.get(name)
  if (!handler) throw new Error(`${name} was never registered`)
  await handler(arg)
  await Promise.resolve()
}

// The accept path is a chain of three settlements deep (notify promise ->
// trash invoke -> its own then), so a couple of microtask ticks is not
// enough to observe it.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('sidebar context menu', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.notifications.length = 0
    h.settles.length = 0
    h.emitted.length = 0
    h.paste.mockClear()
    h.showItemInFolder.mockClear()
    // Without this the trash IPC history leaks across cases, so "nothing is
    // deleted yet" only passes because of test order.
    h.invoke.mockClear()
    h.invoke.mockResolvedValue(undefined)
    activeItem.value = { pathname: '/proj/docs', isDirectory: true }
    createCache.value = {}
    clipboard.value = null
    renameCache.value = null
    vi.stubGlobal('window', {
      path,
      electron: {
        shell: { showItemInFolder: h.showItemInFolder },
        ipcRenderer: { invoke: h.invoke }
      },
      fileUtils: { pathExists: async () => false }
    })
    registerSidebarContextMenuHandlers({ activeItem, createCache, clipboard, renameCache })
  })

  it('stages a new file in the active folder and asks for the inline input', async () => {
    await fire('SIDEBAR::new', 'file')
    expect(createCache.value).toEqual({ dirname: '/proj/docs', type: 'file' })
    expect(h.emitted).toContain('SIDEBAR::show-new-input')
  })

  it('creates inside the parent folder when the selection is a file', async () => {
    activeItem.value = { pathname: '/proj/docs/a.md', isDirectory: false }
    await fire('SIDEBAR::new', 'directory')
    expect(createCache.value).toEqual({ dirname: '/proj/docs', type: 'directory' })
  })

  it('asks for confirmation before trashing (nothing is deleted yet)', async () => {
    await fire('SIDEBAR::remove')
    // UX-07 (#GUI-B10): the confirm notification shows, but no IPC flies.
    expect(h.invoke).not.toHaveBeenCalledWith('mt::fs-trash-item', '/proj/docs')
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0].showConfirm).toBe(true)
  })

  it('trashes through IPC once the confirmation is accepted, and toasts', async () => {
    await fire('SIDEBAR::remove')
    h.settles[0].resolve()
    await flush()
    expect(h.invoke).toHaveBeenCalledWith('mt::fs-trash-item', '/proj/docs')
    expect(h.notifications.some((n) => n.title === 'Moved to trash')).toBe(true)
  })

  it('deletes nothing when the confirmation is dismissed', async () => {
    // The close button rejects the promise. That is a cancel, not a failure:
    // neither the trash IPC nor an error toast may follow it.
    await fire('SIDEBAR::remove')
    h.settles[0].reject()
    await flush()
    expect(h.invoke).not.toHaveBeenCalledWith('mt::fs-trash-item', '/proj/docs')
    expect(h.notifications).toHaveLength(1)
  })

  it('reports a failed trash with the error message after confirmation', async () => {
    h.invoke.mockRejectedValue(new Error('EBUSY'))
    await fire('SIDEBAR::remove')
    h.settles[0].resolve()
    await flush()
    expect(h.notifications[1]).toEqual({
      title: 'Error while deleting',
      type: 'error',
      message: 'EBUSY'
    })
  })

  it('records a non-Error rejection as text', async () => {
    h.invoke.mockRejectedValue('disk busy')
    await fire('SIDEBAR::remove')
    h.settles[0].resolve()
    await flush()
    expect(h.notifications[1].message).toBe('disk busy')
  })

  it('stores what was copied or cut', async () => {
    await fire('SIDEBAR::copy-cut', 'copy')
    expect(clipboard.value).toEqual({ type: 'copy', src: '/proj/docs' })
  })

  it('stages a rename and asks for the rename input', async () => {
    await fire('SIDEBAR::rename')
    expect(renameCache.value).toBe('/proj/docs')
    expect(h.emitted).toContain('SIDEBAR::show-rename-input')
  })

  it('reveals the selection in the file manager', async () => {
    await fire('SIDEBAR::show-in-folder')
    expect(h.showItemInFolder).toHaveBeenCalledWith('/proj/docs')
  })

  it('still registers the paste entry that lives in its own module', async () => {
    expect(h.handlers.has('SIDEBAR::paste')).toBe(true)
    clipboard.value = { type: 'copy', src: '/other/b.md' }
    await fire('SIDEBAR::paste')
    expect(h.paste).toHaveBeenCalledWith({
      type: 'copy',
      src: '/other/b.md',
      dest: '/proj/docs/b.md'
    })
  })
})
