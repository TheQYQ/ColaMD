import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` reads `window.path` at module load and `window.electron` at
// runtime; stub those surfaces before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.slice(0, p.lastIndexOf('/'))
  }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve())
}))

import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { useLayoutStore } from '@/store/layout'

// O12(15): `RESTORE_BUFFERED_STATE` is the other half of the crash buffer —
// `bufferedState.ts` writes the snapshot, this reads it back into a fresh
// window. It had no test anywhere. The rules it owns are the ones that must not
// silently change: every restored tab gets a NEW id, so anything still keyed by
// an old id (the current file, the restore warnings) has to be remapped.

const bufferedTab = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.md`,
  pathname: `/docs/${id}.md`,
  markdown: `# ${id}\n`,
  isSaved: true,
  lineEnding: 'lf',
  ...over
})

const seedExisting = (ids: string[]) => {
  const store = useEditorStore()
  store.tabs = ids.map((id) => bufferedTab(id)) as unknown as typeof store.tabs
  store.currentFile = store.tabs[0] ?? null
  store.tabIdToIndex = Object.fromEntries(ids.map((id, i) => [id, i]))
  store.listToc = [{ slug: 'stale', lvl: 1 }] as unknown as typeof store.listToc
  store.toc = [{ label: 'stale' }] as unknown as typeof store.toc
  return store
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  window.DIRNAME = ''
})

describe('RESTORE_BUFFERED_STATE', () => {
  it('refuses a payload without a tab list instead of blanking the window', () => {
    const store = seedExisting(['a', 'b'])
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.RESTORE_BUFFERED_STATE({ tabs: 'not-an-array' })

    expect(warn).toHaveBeenCalled()
    expect(store.tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('rebuilds every tab under a new id and keeps its document', () => {
    const store = seedExisting(['a'])

    store.RESTORE_BUFFERED_STATE({ tabs: [bufferedTab('a'), bufferedTab('b')] })

    const ids = store.tabs.map((t) => t.id)
    expect(store.tabs).toHaveLength(2)
    expect(ids).not.toContain('a')
    expect(store.tabs.map((t) => t.pathname)).toEqual(['/docs/a.md', '/docs/b.md'])
    expect(store.tabs[1].markdown).toBe('# b\n')
    expect(store.tabIdToIndex).toEqual({ [ids[0]]: 0, [ids[1]]: 1 })
  })

  it('follows the old current-file id to the tab that replaced it', () => {
    const store = seedExisting(['a'])

    store.RESTORE_BUFFERED_STATE({
      tabs: [bufferedTab('a'), bufferedTab('b')],
      currentFileId: 'b'
    })

    expect(store.currentFile?.pathname).toBe('/docs/b.md')
    expect(window.DIRNAME).toBe('/docs')
  })

  it('leaves no current tab and clears DIRNAME when the id matches nothing', () => {
    const store = seedExisting(['a'])

    store.RESTORE_BUFFERED_STATE({ tabs: [bufferedTab('a')], currentFileId: 'gone' })

    expect(store.currentFile).toBeNull()
    expect(window.DIRNAME).toBe('')
  })

  it('drops the outline mirrors and re-derives the line-ending menu', () => {
    const store = seedExisting(['a'])
    store.UPDATE_LINE_ENDING_MENU = vi.fn()

    store.RESTORE_BUFFERED_STATE({ tabs: [bufferedTab('a')] })

    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
    expect(store.UPDATE_LINE_ENDING_MENU).toHaveBeenCalledTimes(1)
  })

  it('hands the project and layout halves of the snapshot to their own stores', () => {
    const store = seedExisting(['a'])
    const projectRestore = vi.spyOn(useProjectStore(), 'RESTORE_BUFFERED_STATE')
    const layoutRestore = vi.spyOn(useLayoutStore(), 'RESTORE_BUFFERED_STATE')

    store.RESTORE_BUFFERED_STATE({
      editor: { tabs: [bufferedTab('a')] },
      project: { projectTree: null },
      layout: { showSideBar: true }
    })

    expect(projectRestore).toHaveBeenCalledWith({ projectTree: null })
    expect(layoutRestore).toHaveBeenCalledWith({ showSideBar: true })
    // The nested form must not be mistaken for the editor state itself.
    expect(store.tabs).toHaveLength(1)
  })

  it('re-attaches restore warnings to the tab they now belong to', () => {
    const store = seedExisting(['a'])

    store.RESTORE_BUFFERED_STATE({
      tabs: [bufferedTab('a'), bufferedTab('b')],
      currentFileId: 'a',
      restoreWarnings: [
        { tabId: 'a', msg: 'line endings normalised', showConfirm: false, style: 'warn' },
        { pathname: '/docs/b.md', msg: 'file changed on disk' },
        { pathname: '/docs/gone.md', msg: 'matches nothing' }
      ]
    })

    const [first, second] = store.tabs
    expect(first.notifications).toHaveLength(1)
    expect(first.notifications[0].msg).toBe('line endings normalised')
    expect(second.notifications).toHaveLength(1)
    expect(second.notifications[0].msg).toBe('file changed on disk')
  })

  it('accepts the flat form the editor store itself produces', () => {
    const store = seedExisting(['a'])

    store.RESTORE_BUFFERED_STATE(store.CREATE_BUFFERED_STATE())

    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].pathname).toBe('/docs/a.md')
  })
})
