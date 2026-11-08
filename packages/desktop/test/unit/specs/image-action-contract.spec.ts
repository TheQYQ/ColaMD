import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The engine's `imageAction` hook is called with a `{ src, alt, title }` state
// object (see `IMuyaOptions.imageAction` in packages/muya/src/types.ts) — NOT
// with a bare path string. `useEditorImages` therefore ships TWO callbacks:
//
//   - `imageAction(image, id, alt)`     — the desktop's own shape
//   - `muyaImageAction(state)`          — the adapter for the engine's shape
//
// `createMuyaOptions` handed the engine the FIRST one under the second one's
// name (`const { imageAction: muyaImageAction } = useEditorImages()`). The
// engine then called it with a state object, the desktop read `state.src` off
// a string argument, and the pasted bitmap was treated as a local path:
// its base64 payload was written into the document verbatim and the follow-up
// `file.arrayBuffer()` threw, leaving one line of base64 garbage behind.
//
// This spec pins the WIRING (which callback the engine receives), because the
// bug was never in either callback — it was in the choice between them.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: Record<string, unknown>
      fileUtils?: Record<string, unknown>
      electron?: Record<string, unknown>
      colamd?: { env: { windowId: number } }
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.replace(/\/[^/]*$/, '') || '/',
    basename: (p: string) => p.split('/').pop() ?? p,
    extname: (p: string) => /\.[^.]*$/.exec(p)?.[0] ?? '',
    isAbsolute: (p: string) => p.startsWith('/'),
    join: (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/'),
    normalize: (p: string) => p,
    resolve: (...parts: string[]) => `/${parts.join('/')}`.replace(/\/{2,}/g, '/'),
    relative: (from: string, to: string) => to
  }
  w.window.fileUtils ??= {
    ensureDir: vi.fn(() => Promise.resolve()),
    isImageFile: vi.fn(() => Promise.resolve(true)),
    copy: vi.fn(() => Promise.resolve()),
    writeFile: vi.fn(() => Promise.resolve())
  }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {}, invoke: () => Promise.resolve('') },
    process: { platform: 'linux' }
  }
  w.window.colamd ??= { env: { windowId: 1 } }
  w.window.DIRNAME = '/docs'
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))

const { createMuyaOptions } = await import('@/components/editorWithTabs/muyaOptions')
const { useEditorStore } = await import('@/store/editor')
const { usePreferencesStore } = await import('@/store/preferences')

/** The engine-facing callback under the shape the engine actually uses. */
type EngineImageAction = (state: { src: string; alt?: string; title?: string }) => Promise<string>

// The desktop's `imageAction` returns '' when no document is open, so the
// callback under test never reaches the persistence branch without one. Give
// it a saved document so the WRONG wiring is observable.
const openDocument = (): void => {
  const editorStore = useEditorStore()
  editorStore.currentFile = {
    id: 'tab-1',
    pathname: '/docs/note.md',
    filename: 'note.md',
    markdown: 'hello\n',
    cursor: 0,
    history: [],
    scrollTop: 0
  } as never

  const preferencesStore = usePreferencesStore()
  preferencesStore.imageFolderPath = '/docs/images'
}

describe('createMuyaOptions — the engine imageAction hook', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    openDocument()
  })

  it('is wired at all (a missing hook silently disables image persistence)', () => {
    const options = createMuyaOptions('hello\n')
    expect(typeof options.imageAction).toBe('function')
  })

  it('accepts the engine state object and persists the resolved `state.src`', async () => {
    const options = createMuyaOptions('hello\n')
    const imageAction = options.imageAction as EngineImageAction

    // The engine calls the hook with `{ src, alt, title }`. If the desktop's
    // own `(image, id, alt)` callback is wired here instead, the state OBJECT
    // reaches the persistence layer, `typeof image === 'string'` is false, and
    // the binary branch dereferences `file.arrayBuffer` on a plain object —
    // throwing `file.arrayBuffer is not a function`. That throw is what left
    // the base64 payload inline in the document as one line of garbage.
    const result = await imageAction({
      src: '/docs/photo.png',
      alt: '',
      title: ''
    })

    // The persisted destination (copy-to-assets): a path under the image
    // folder, named by the content hash.
    expect(result.startsWith('/docs/images/')).toBe(true)
    expect(result.endsWith('.png')).toBe(true)
  })

  it('resolves the state object to its `src` before touching the filesystem', async () => {
    const options = createMuyaOptions('hello\n')
    const imageAction = options.imageAction as EngineImageAction

    await imageAction({ src: '/docs/photo.png', alt: '', title: '' })

    // The persistence layer probed the RESOLVED src — proof the adapter
    // unwrapped `state.src` instead of passing the whole object through.
    const isImageFile = window.fileUtils.isImageFile as unknown as ReturnType<typeof vi.fn>
    expect(isImageFile).toHaveBeenCalled()
    expect(String(isImageFile.mock.calls[0][0])).toContain('photo.png')
    expect(String(isImageFile.mock.calls[0][0])).not.toContain('[object Object]')
  })

  it('never treats the state object itself as an image path', async () => {
    const options = createMuyaOptions('hello\n')
    const imageAction = options.imageAction as EngineImageAction

    const result = await imageAction({
      src: '/docs/photo.png',
      alt: '',
      title: ''
    })

    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('src=')
  })
})
