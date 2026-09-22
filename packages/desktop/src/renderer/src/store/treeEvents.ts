import { addFile, unlinkFile, addDirectory, unlinkDirectory, updateFileMtime } from './treeCtrl'
import { getFileStateFromData } from './help'
import type { TreeNode } from '../components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'

// O12 step 6 — the sidebar's directory-watch reducer, lifted out of
// `store/project.ts`'s setup (the longest function in the desktop package).
// It was already a pure switch over one tree object and one change record; what
// kept it inside the store was that it reaches for three stores and two refs.
// Those arrive here as `TreeEventContext`, so the branch logic can be tested
// without mounting Pinia.

export interface TreeEventContext {
  /** The live project root; the tree helpers mutate it in place. */
  tree: TreeNode
  fileSortBy: string
  fileSortOrder: string
  /**
   * The path of the file the sidebar just asked to create, or '' when no new-file
   * dialog is outstanding. chokidar reports that file like any other addition,
   * and the match is what adopts the opened document into the tab.
   */
  pendingNewFileName: string
  adoptCreatedFile: (fileState: ReturnType<typeof getFileStateFromData>) => void
  forgetPendingNewFileName: () => void
  fileRemoved: (change: FileChangeDetail) => void
}

export const processTreeEvent = (
  ctx: TreeEventContext,
  type: string,
  change: FileChangeDetail
): void => {
  switch (type) {
    case 'add': {
      const { pathname, data, isMarkdown } = change
      addFile(ctx.tree, change as Parameters<typeof addFile>[1], ctx.fileSortBy, ctx.fileSortOrder)
      if (isMarkdown && ctx.pendingNewFileName && pathname === ctx.pendingNewFileName) {
        ctx.adoptCreatedFile(getFileStateFromData(data as Record<string, unknown>))
        ctx.forgetPendingNewFileName()
      }
      break
    }
    case 'unlink':
      unlinkFile(ctx.tree, change)
      ctx.fileRemoved(change)
      break
    case 'addDir':
      addDirectory(ctx.tree, change)
      break
    case 'unlinkDir':
      unlinkDirectory(ctx.tree, change)
      break
    case 'change':
      if (change?.mtimeMs !== undefined) {
        updateFileMtime(
          ctx.tree,
          change as Parameters<typeof updateFileMtime>[1],
          ctx.fileSortBy,
          ctx.fileSortOrder
        )
      }
      break
    default:
      if (window.electron?.process?.env?.NODE_ENV === 'development') {
        console.log(`Unknown directory watch type: "${type}"`)
      }
      break
  }
}
