import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sidebar's Paste handler was the second cluster lifted out of
// `store/project.ts`'s setup (after the directory-watch reducer). It is the one
// place in the sidebar that invents a file name, and nothing tested it -- the
// interesting cases are all "must not happen twice": pasting a cut back onto its
// own folder, and a copy whose `( copy N)` names are all already taken.

const h = vi.hoisted(() => {
  const handlers = new Map<string, () => unknown>()
  const notifications: Array<{ title: string; type: string; message: string }> = []
  const taken = new Set<string>()
  return { handlers, notifications, taken, paste: vi.fn(async () => undefined) }
})

vi.mock('../../../src/renderer/src/bus', () => ({
  default: {
    on: (name: string, fn: () => unknown) => h.handlers.set(name, fn),
    emit: vi.fn()
  }
}))
vi.mock('../../../src/renderer/src/services/notification', () => ({
  default: {
    notify: (n: { title: string; type: string; message: string }) => h.notifications.push(n)
  }
}))
vi.mock('../../../src/renderer/src/util/fileSystem', () => ({
  paste: h.paste
}))
vi.mock('../../../src/renderer/src/config', () => ({ PATH_SEPARATOR: '/' }))

import {
  MAX_COPIES,
  registerSidebarPasteHandler,
  resolveCopyDestination
} from '../../../src/renderer/src/store/sidebarPaste'

const exists = async (p: string): Promise<boolean> => h.taken.has(p)

const fire = async (): Promise<void> => {
  const handler = h.handlers.get('SIDEBAR::paste')
  if (!handler) throw new Error('SIDEBAR::paste was never registered')
  await handler()
  await Promise.resolve()
  await Promise.resolve()
}

describe('sidebar paste', () => {
  beforeEach(() => {
    h.notifications.length = 0
    h.taken.clear()
    h.paste.mockClear()
    vi.stubGlobal('window', {
      path,
      fileUtils: { pathExists: exists }
    })
    registerSidebarPasteHandler({ activeItem, clipboard })
  })

  const activeItem = { value: { pathname: '/proj/docs', isDirectory: true } }
  const clipboard = { value: null as null | { type: string; src: string; dest?: string } }

  it('names a free copy "(copy)" and the next one "(copy 2)"', async () => {
    expect((await resolveCopyDestination('/proj/a.md', '/proj', exists)).dest).toBe(
      path.join('/proj', 'a (copy).md').replace(/\\/g, '/')
    )
    h.taken.add('/proj/a (copy).md')
    expect((await resolveCopyDestination('/proj/a.md', '/proj', exists)).dest).toBe(
      '/proj/a (copy 2).md'
    )
  })

  it('refuses to invent a name past the ceiling', async () => {
    for (let i = 1; i <= MAX_COPIES; i++) {
      h.taken.add(`/proj/a (copy${i === 1 ? '' : ' ' + i}).md`)
    }
    h.taken.add('/proj/a (copy).md')
    const r = await resolveCopyDestination('/proj/a.md', '/proj', exists)
    expect(r.failure).toContain(`Maximum of ${MAX_COPIES} copies reached`)
  })

  it('pasting a cut back into its own folder warns and does not paste', async () => {
    clipboard.value = { type: 'cut', src: '/proj/docs/a.md' }
    await fire()
    expect(h.notifications.map((n) => n.title)).toEqual(['Paste Forbidden'])
    expect(h.paste).not.toHaveBeenCalled()
  })

  it('pastes into the active folder and clears the clipboard', async () => {
    clipboard.value = { type: 'copy', src: '/other/b.md' }
    await fire()
    expect(h.paste).toHaveBeenCalledWith({
      type: 'copy',
      src: '/other/b.md',
      dest: '/proj/docs/b.md'
    })
    expect(clipboard.value).toBeNull()
  })

  it('does nothing without a clipboard entry', async () => {
    clipboard.value = null
    await fire()
    expect(h.paste).not.toHaveBeenCalled()
    expect(h.notifications).toEqual([])
  })
})
