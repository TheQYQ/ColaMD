// Pure navigation model for the sidebar file tree's keyboard support.
//
// tree.vue gathers the currently visible rows from the DOM (visual order,
// folders before files per level, collapsed subtrees absent) into a
// TreeRowModel[] and delegates every key decision to `nextTreeNavState`,
// which stays free of DOM access so the traversal rules are unit-testable.
// The DOM glue in tree.vue only reads row datasets and applies the returned
// action.

type TreeRowKind = 'file' | 'folder'

export interface TreeRowModel {
  /** Row identity: the node pathname (unique within one opened project). */
  pathname: string
  kind: TreeRowKind
  depth: number
  /** Folders only: whether the folder is currently expanded. */
  expanded: boolean
}

export type TreeNavKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'Home'
  | 'End'
  | 'Enter'
  | 'F2'
  | 'Delete'

export type TreeNavAction =
  | { type: 'focus'; index: number }
  | { type: 'open' }
  | { type: 'toggle' }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'rename' }
  | { type: 'remove' }
  | { type: 'none' }

/** Nearest preceding row shallower than `fromIndex` — the folder that owns it. */
function findParentIndex(rows: TreeRowModel[], fromIndex: number): number {
  const depth = rows[fromIndex].depth
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (rows[i].depth < depth) return i
  }
  return -1
}

/**
 * Resolve `key` against the visible rows and the currently keyboard-focused
 * index (`-1` when nothing is focused). Returns a `focus` action with the new
 * index for movements, an item action (open/toggle/expand/collapse/rename/
 * remove) for the focused row, or `none` when the key is a no-op.
 */
export function nextTreeNavState(
  rows: TreeRowModel[],
  currentIndex: number,
  key: TreeNavKey
): TreeNavAction {
  if (rows.length === 0) return { type: 'none' }

  const move = (index: number): TreeNavAction => ({
    type: 'focus',
    index: Math.max(0, Math.min(rows.length - 1, index))
  })

  if (currentIndex < 0 || currentIndex >= rows.length) {
    if (key === 'ArrowDown' || key === 'Home') return { type: 'focus', index: 0 }
    if (key === 'ArrowUp' || key === 'End') return { type: 'focus', index: rows.length - 1 }
    return { type: 'none' }
  }

  const row = rows[currentIndex]
  const isFolder = row.kind === 'folder'

  switch (key) {
    case 'ArrowDown':
      return move(currentIndex + 1)
    case 'ArrowUp':
      return move(currentIndex - 1)
    case 'Home':
      return { type: 'focus', index: 0 }
    case 'End':
      return { type: 'focus', index: rows.length - 1 }
    case 'ArrowRight':
      if (isFolder && !row.expanded) return { type: 'expand' }
      if (isFolder && currentIndex < rows.length - 1) {
        return { type: 'focus', index: currentIndex + 1 }
      }
      return { type: 'none' }
    case 'ArrowLeft': {
      if (isFolder && row.expanded) return { type: 'collapse' }
      const parent = findParentIndex(rows, currentIndex)
      return parent === -1 ? { type: 'none' } : { type: 'focus', index: parent }
    }
    case 'Enter':
      return isFolder ? { type: 'toggle' } : { type: 'open' }
    case 'F2':
      return { type: 'rename' }
    case 'Delete':
      return { type: 'remove' }
    default:
      return { type: 'none' }
  }
}
