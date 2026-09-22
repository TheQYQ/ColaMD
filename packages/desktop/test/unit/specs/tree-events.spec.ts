import { describe, it, expect, vi, beforeEach } from 'vitest'

// O12 step 6 — the directory-watch reducer lifted out of `store/project.ts`.
// Nothing tested it before: the switch sat inside the store's setup, so every
// branch needed Pinia plus two more stores. With the side effects passed in as
// a context, the branch table is directly testable, which is what this file is
// for — including the two "must not happen" cases (a change event without an
// mtime, and an unknown watch type).

vi.mock('../../../src/renderer/src/store/treeCtrl', () => ({
  addFile: vi.fn(),
  unlinkFile: vi.fn(),
  addDirectory: vi.fn(),
  unlinkDirectory: vi.fn(),
  updateFileMtime: vi.fn()
}))

vi.mock('../../../src/renderer/src/store/help', () => ({
  getFileStateFromData: (data: unknown) => ({ adoptedFrom: data })
}))

import {
  addFile,
  unlinkFile,
  addDirectory,
  unlinkDirectory,
  updateFileMtime
} from '@/store/treeCtrl'
import { processTreeEvent, type TreeEventContext } from '@/store/treeEvents'
import type { TreeNode } from '@/components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'

const tree = { pathname: '/root' } as TreeNode

const makeContext = (
  over: Partial<
    Pick<TreeEventContext, 'tree' | 'fileSortBy' | 'fileSortOrder' | 'pendingNewFileName'>
  > = {}
) => {
  const spies = {
    adoptCreatedFile: vi.fn<TreeEventContext['adoptCreatedFile']>(),
    forgetPendingNewFileName: vi.fn<TreeEventContext['forgetPendingNewFileName']>(),
    fileRemoved: vi.fn<TreeEventContext['fileRemoved']>()
  }
  const ctx: TreeEventContext = {
    tree,
    fileSortBy: 'name',
    fileSortOrder: 'asc',
    pendingNewFileName: '',
    ...spies,
    ...over
  }
  return { ctx, spies }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processTreeEvent', () => {
  it('adds a file through the sort-aware tree helper', () => {
    const change = { pathname: '/root/a.md', data: {}, isMarkdown: false } as FileChangeDetail

    processTreeEvent(makeContext().ctx, 'add', change)

    expect(addFile).toHaveBeenCalledWith(tree, change, 'name', 'asc')
  })

  it('adopts the document of the file the sidebar just created, then clears the cache', () => {
    const { ctx, spies } = makeContext({ pendingNewFileName: '/root/new.md' })
    const change = {
      pathname: '/root/new.md',
      data: { markdown: '# hi' },
      isMarkdown: true
    } as FileChangeDetail

    processTreeEvent(ctx, 'add', change)

    expect(spies.adoptCreatedFile).toHaveBeenCalledWith({ adoptedFrom: { markdown: '# hi' } })
    expect(spies.forgetPendingNewFileName).toHaveBeenCalledTimes(1)
  })

  it('leaves an unrelated markdown addition alone', () => {
    const { ctx, spies } = makeContext({ pendingNewFileName: '/root/new.md' })
    const change = { pathname: '/root/other.md', data: {}, isMarkdown: true } as FileChangeDetail

    processTreeEvent(ctx, 'add', change)

    expect(addFile).toHaveBeenCalledTimes(1)
    expect(spies.adoptCreatedFile).not.toHaveBeenCalled()
    expect(spies.forgetPendingNewFileName).not.toHaveBeenCalled()
  })

  it('mirrors a removal into the save status of any tab on that path', () => {
    const { ctx, spies } = makeContext()
    const change = { pathname: '/root/gone.md' } as FileChangeDetail

    processTreeEvent(ctx, 'unlink', change)

    expect(unlinkFile).toHaveBeenCalledWith(tree, change)
    expect(spies.fileRemoved).toHaveBeenCalledWith(change)
  })

  it('handles directories through their own helpers', () => {
    const { ctx } = makeContext()

    processTreeEvent(ctx, 'addDir', { pathname: '/root/sub' } as FileChangeDetail)
    processTreeEvent(ctx, 'unlinkDir', { pathname: '/root/sub' } as FileChangeDetail)

    expect(addDirectory).toHaveBeenCalledTimes(1)
    expect(unlinkDirectory).toHaveBeenCalledTimes(1)
  })

  it('re-sorts on a change that carries an mtime, and ignores one that does not', () => {
    const { ctx } = makeContext()
    const withMtime = { pathname: '/root/a.md', mtimeMs: 12 } as FileChangeDetail

    processTreeEvent(ctx, 'change', withMtime)
    expect(updateFileMtime).toHaveBeenCalledWith(tree, withMtime, 'name', 'asc')

    vi.clearAllMocks()
    processTreeEvent(ctx, 'change', { pathname: '/root/a.md' } as FileChangeDetail)
    expect(updateFileMtime).not.toHaveBeenCalled()
  })

  it('swallows an unknown watch type', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx } = makeContext()

    processTreeEvent(ctx, 'somethingElse', {} as FileChangeDetail)

    expect(addFile).not.toHaveBeenCalled()
    expect(unlinkFile).not.toHaveBeenCalled()
    expect(updateFileMtime).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
