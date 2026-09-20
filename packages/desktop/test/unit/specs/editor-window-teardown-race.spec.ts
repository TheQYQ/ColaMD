import { describe, expect, it, vi } from 'vitest'

// O25 — `destroy()` used to null every bookkeeping field while the window stays
// reachable from queued work: an in-flight `loadMarkdownFile` promise, or a
// watcher IPC that arrives after teardown, hit `this._openedFiles!` / `browserWindow!`
// and threw a bare TypeError. The fields are now emptied instead of nulled and the
// sends are optional-chained, so teardown races resolve to a no-op.

const { emitted } = vi.hoisted(() => ({ emitted: [] as unknown[][] }))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: { showMessageBox: vi.fn() },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    emit: vi.fn((...args: unknown[]) => {
      emitted.push(args)
    })
  }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import type Accessor from '../../../src/main/app/accessor'
import EditorWindow from '../../../src/main/windows/editor'
import { WindowLifecycle } from '../../../src/main/windows/base'

const stubAccessor = (): Accessor =>
  ({
    menu: { addRecentlyUsedDocument: vi.fn() },
    preferences: { getItem: vi.fn(() => false), getAll: vi.fn(() => ({})) }
  }) as unknown as Accessor

describe('O25 — an editor window survives calls that arrive after destroy()', () => {
  it('leaves the lifecycle quit and the state emptied, not null', () => {
    const editor = new EditorWindow(stubAccessor())
    editor.destroy()

    expect(editor.lifecycle).toBe(WindowLifecycle.QUITTED)
    expect(editor.openedRootDirectory).toBe('')
    expect(editor.getCandidateScores(['/tmp/a.md'])).toEqual([{ id: null, score: 0 }])
  })

  it('tracks opened files through the whole watcher surface without throwing', () => {
    const editor = new EditorWindow(stubAccessor())
    editor.destroy()

    expect(() => editor.addToOpenedFiles('/tmp/a.md')).not.toThrow()
    expect(() => editor.changeOpenedFilePath('/tmp/b.md', '/tmp/a.md')).not.toThrow()
    expect(() => editor.removeFromOpenedFiles('/tmp/b.md')).not.toThrow()
    expect(editor.getCandidateScores(['/tmp/c.md']).map((s) => s.score)).toEqual([0])
  })

  it('still refuses to open anything once quit', () => {
    const editor = new EditorWindow(stubAccessor())
    editor.destroy()
    emitted.length = 0

    editor.openTab('/tmp/a.md')
    editor.openTabsFromPaths(['/tmp/b.md'])
    editor.openUntitledTab(true, '# hi')
    editor.openFolder('/tmp')

    expect(emitted).toHaveLength(0)
    expect(editor.getCandidateScores(['/tmp/a.md']).map((s) => s.score)).toEqual([0])
  })
})
