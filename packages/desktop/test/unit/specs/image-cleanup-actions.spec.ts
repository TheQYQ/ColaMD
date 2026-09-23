import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState } from '@shared/types/files'

// `@/store/editor` reads `window.path` at module load and `window.electron` at
// runtime; stub those surfaces before the hoisted imports run. The path stub is
// posix-shaped because `window.path` is pathe-based in the app too — including
// `resolve`, which has to fold `..` away or an escape path looks like a hit.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: {
        sep: string
        dirname: (p: string) => string
        basename: (p: string) => string
        extname: (p: string) => string
        isAbsolute: (p: string) => boolean
        resolve: (...parts: string[]) => string
      }
      fileUtils?: {
        isSamePathSync: (a: string, b: string) => boolean
        isChildOfDirectory: (dir: string, child: string) => boolean
        pathExists: (p: string) => Promise<boolean>
        unlink: (p: string) => Promise<void>
      }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          once: (...a: unknown[]) => void
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) || '/',
    basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
    extname: (p: string) => {
      const name = p.slice(p.lastIndexOf('/') + 1)
      const dot = name.lastIndexOf('.')
      return dot <= 0 ? '' : name.slice(dot)
    },
    isAbsolute: (p: string) => p.startsWith('/'),
    resolve: (...parts: string[]) => {
      const out: string[] = []
      for (const seg of parts.join('/').split('/')) {
        if (!seg || seg === '.') continue
        if (seg === '..') out.pop()
        else out.push(seg)
      }
      return `/${out.join('/')}`
    }
  }
  w.window.fileUtils ??= {
    isSamePathSync: (a, b) => a === b,
    isChildOfDirectory: (dir, child) => child.startsWith(`${dir}/`),
    pathExists: async () => true,
    unlink: async () => {}
  }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: () => {}, once: vi.fn() }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve())
}))

import notice from '@/services/notification'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const IMAGE_CLEANUP_DELAY_MS = 5000

// The cleanup action is always reached through `.catch(...)`, so every stub for
// it has to hand back a promise.
const cleanupStub = () => vi.fn().mockResolvedValue(undefined)

const send = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.send)
const once = (): ReturnType<typeof vi.fn> => vi.mocked(window.electron.ipcRenderer.once)

const tab = (over: Partial<IFileState> = {}): IFileState =>
  ({
    id: 'tab-1',
    filename: 'note.md',
    pathname: '/docs/note.md',
    markdown: '# note\n',
    isSaved: true,
    history: {},
    cursor: null,
    scrollTop: 0,
    muyaIndexCursor: null,
    ...over
  }) as unknown as IFileState

const seed = (tabs: IFileState[]) => {
  const store = useEditorStore()
  store.tabs = tabs
  store.currentFile = tabs[0] ?? null
  store.updateTabIdToIndex()
  return store
}

const allowCleanup = () => {
  const preferences = usePreferencesStore()
  preferences.deleteUnreferencedImages = true
  preferences.imageFolderPath = ''
  return preferences
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useFakeTimers()
  setActivePinia(createPinia())
  window.DIRNAME = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ASK_FOR_IMAGE_AUTO_PATH', () => {
  it('answers with nothing when there is no tab to complete against', async () => {
    const store = seed([])
    await expect(store.ASK_FOR_IMAGE_AUTO_PATH('./im')).resolves.toEqual([])
    expect(send().mock.calls).toEqual([])
  })

  it('answers with nothing for an unsaved document', async () => {
    const store = seed([tab({ pathname: '' })])
    await expect(store.ASK_FOR_IMAGE_AUTO_PATH('./im')).resolves.toEqual([])
    expect(send().mock.calls).toEqual([])
  })

  it('asks main on the shared channel and resolves on the per-request reply address', async () => {
    const store = seed([tab()])

    const pending = store.ASK_FOR_IMAGE_AUTO_PATH('./img/a.png')
    const request = send().mock.calls.find((c: unknown[]) => c[0] === 'mt::ask-for-image-auto-path')
    expect(request?.[1]).toMatchObject({
      pathname: '/docs/note.md',
      src: './img/a.png'
    })
    const id = (request?.[1] as { id: string }).id
    // The reply channel is created per request, so it is not a contract channel.
    const reply = once().mock.calls.find(
      (c: unknown[]) => c[0] === `mt::response-of-image-path-${id}`
    )
    expect(reply).toBeTruthy()
    ;(reply?.[1] as (event: unknown, files: string[]) => void)(null, ['/docs/img/a.png'])

    await expect(pending).resolves.toEqual(['/docs/img/a.png'])
    // The document crosses the boundary as a detached copy, never the live tab.
    expect((request?.[1] as { currentFile: IFileState }).currentFile).not.toBe(store.currentFile)
  })
})

describe('IMAGE_DELETED', () => {
  it('does nothing while the preference is off', () => {
    const store = seed([tab({ markdown: '![](./img/a.png)\n' })])
    const cleanup = cleanupStub()
    store.CLEANUP_UNREFERENCED_IMAGE = cleanup

    store.IMAGE_DELETED({ src: './img/a.png' })
    vi.advanceTimersByTime(IMAGE_CLEANUP_DELAY_MS * 2)

    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does nothing for an unsaved document or a source outside the domain', () => {
    allowCleanup()
    const unsaved = seed([tab({ pathname: '' })])
    const cleanup = cleanupStub()
    unsaved.CLEANUP_UNREFERENCED_IMAGE = cleanup
    unsaved.IMAGE_DELETED({ src: './img/a.png' })

    const saved = seed([tab()])
    saved.CLEANUP_UNREFERENCED_IMAGE = cleanup
    const outside = ['https://x/a.png', 'data:image/png;base64,AAA', './notes.md', '../out.png']
    for (const src of outside) {
      saved.IMAGE_DELETED({ src })
    }

    vi.advanceTimersByTime(IMAGE_CLEANUP_DELAY_MS * 2)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('debounces per file and cleans up once the window passes', () => {
    allowCleanup()
    const store = seed([tab({ markdown: '# note\n' })])
    const cleanup = cleanupStub()
    store.CLEANUP_UNREFERENCED_IMAGE = cleanup

    store.IMAGE_DELETED({ src: './img/a.png' })
    store.IMAGE_DELETED({ src: './img/a.png' })
    expect(cleanup).not.toHaveBeenCalled()

    vi.advanceTimersByTime(IMAGE_CLEANUP_DELAY_MS)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith({
      absolutePath: '/docs/img/a.png',
      rawSrc: './img/a.png'
    })
  })

  it('keeps a cleanup that failed from breaking the caller', async () => {
    allowCleanup()
    const store = seed([tab({ markdown: '# note\n' })])
    store.CLEANUP_UNREFERENCED_IMAGE = vi.fn().mockRejectedValue(new Error('EIO'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.IMAGE_DELETED({ src: './img/a.png' })
    await vi.runAllTimersAsync()

    expect(error).toHaveBeenCalled()
  })
})

describe('CLEANUP_UNREFERENCED_IMAGE', () => {
  const candidate = { absolutePath: '/docs/img/a.png', rawSrc: './img/a.png' }

  it('flushes first, then unlinks and reports', async () => {
    const store = seed([tab({ markdown: '# note\n' })])
    const flush = vi.spyOn(store, 'flushActiveEditor')
    const unlink = vi.spyOn(window.fileUtils, 'unlink').mockResolvedValue(undefined)

    await store.CLEANUP_UNREFERENCED_IMAGE(candidate)

    expect(flush).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalledWith('/docs/img/a.png')
    expect(notice.notify).toHaveBeenCalledTimes(1)
  })

  it('leaves the file alone while any open tab still references it', async () => {
    const store = seed([
      tab({ id: 'a', markdown: '# note\n' }),
      tab({ id: 'b', pathname: '/docs/other.md', markdown: '![](img/a.png)\n' })
    ])
    const unlink = vi.spyOn(window.fileUtils, 'unlink')

    await store.CLEANUP_UNREFERENCED_IMAGE(candidate)

    expect(unlink).not.toHaveBeenCalled()
    expect(notice.notify).not.toHaveBeenCalled()
  })

  it('skips a file that is already gone', async () => {
    const store = seed([tab({ markdown: '# note\n' })])
    vi.spyOn(window.fileUtils, 'pathExists').mockResolvedValue(false)
    const unlink = vi.spyOn(window.fileUtils, 'unlink')

    await store.CLEANUP_UNREFERENCED_IMAGE(candidate)

    expect(unlink).not.toHaveBeenCalled()
  })

  it('swallows a failed unlink instead of rejecting into the timer', async () => {
    const store = seed([tab({ markdown: '# note\n' })])
    vi.spyOn(window.fileUtils, 'unlink').mockRejectedValue(new Error('EPERM'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(store.CLEANUP_UNREFERENCED_IMAGE(candidate)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    expect(notice.notify).not.toHaveBeenCalled()
  })
})
