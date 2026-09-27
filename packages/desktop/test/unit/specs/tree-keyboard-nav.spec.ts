import { describe, expect, it } from 'vitest'
import { nextTreeNavState, type TreeRowModel } from '@/components/sideBar/treeKeyboard'

// A small visible-rows fixture in visual order (as the DOM would report it):
// a/ is expanded and holds an expanded b/ (with c.md) and d.md; z.md sits at
// the project root.
const rows: TreeRowModel[] = [
  { pathname: '/p/a', kind: 'folder', depth: 0, expanded: true },
  { pathname: '/p/a/b', kind: 'folder', depth: 1, expanded: true },
  { pathname: '/p/a/b/c.md', kind: 'file', depth: 2, expanded: false },
  { pathname: '/p/a/d.md', kind: 'file', depth: 1, expanded: false },
  { pathname: '/p/z.md', kind: 'file', depth: 0, expanded: false }
]

const idx = (pathname: string): number => rows.findIndex((r) => r.pathname === pathname)

describe('nextTreeNavState — empty and unfocused states', () => {
  it('is a no-op on an empty tree', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'F2', 'Delete'] as const) {
      expect(nextTreeNavState([], -1, key)).toEqual({ type: 'none' })
    }
  })

  it('focuses the first/last row when nothing is focused yet', () => {
    expect(nextTreeNavState(rows, -1, 'ArrowDown')).toEqual({ type: 'focus', index: 0 })
    expect(nextTreeNavState(rows, -1, 'ArrowUp')).toEqual({ type: 'focus', index: rows.length - 1 })
    expect(nextTreeNavState(rows, -1, 'Home')).toEqual({ type: 'focus', index: 0 })
    expect(nextTreeNavState(rows, -1, 'End')).toEqual({ type: 'focus', index: rows.length - 1 })
  })

  it('does not act on item keys without a focused row', () => {
    expect(nextTreeNavState(rows, -1, 'Enter')).toEqual({ type: 'none' })
    expect(nextTreeNavState(rows, -1, 'F2')).toEqual({ type: 'none' })
    expect(nextTreeNavState(rows, -1, 'Delete')).toEqual({ type: 'none' })
  })
})

describe('nextTreeNavState — vertical movement', () => {
  it('moves down and up one row', () => {
    expect(nextTreeNavState(rows, idx('/p/a'), 'ArrowDown')).toEqual({ type: 'focus', index: 1 })
    expect(nextTreeNavState(rows, idx('/p/a/d.md'), 'ArrowDown')).toEqual({
      type: 'focus',
      index: 4
    })
    expect(nextTreeNavState(rows, idx('/p/a/d.md'), 'ArrowUp')).toEqual({ type: 'focus', index: 2 })
  })

  it('clamps at both ends', () => {
    expect(nextTreeNavState(rows, 0, 'ArrowUp')).toEqual({ type: 'focus', index: 0 })
    expect(nextTreeNavState(rows, rows.length - 1, 'ArrowDown')).toEqual({
      type: 'focus',
      index: rows.length - 1
    })
  })

  it('jumps with Home and End', () => {
    expect(nextTreeNavState(rows, 2, 'Home')).toEqual({ type: 'focus', index: 0 })
    expect(nextTreeNavState(rows, 2, 'End')).toEqual({ type: 'focus', index: rows.length - 1 })
  })
})

describe('nextTreeNavState — horizontal expansion', () => {
  it('expands a collapsed folder with ArrowRight', () => {
    const collapsed = rows.map((r) => (r.pathname === '/p/a' ? { ...r, expanded: false } : r))
    expect(nextTreeNavState(collapsed, 0, 'ArrowRight')).toEqual({ type: 'expand' })
  })

  it('descends into an expanded folder with ArrowRight', () => {
    expect(nextTreeNavState(rows, idx('/p/a'), 'ArrowRight')).toEqual({ type: 'focus', index: 1 })
  })

  it('does nothing on ArrowRight for a file or a last-row folder', () => {
    expect(nextTreeNavState(rows, idx('/p/z.md'), 'ArrowRight')).toEqual({ type: 'none' })
    expect(nextTreeNavState(rows, rows.length - 1, 'ArrowRight')).toEqual({ type: 'none' })
  })

  it('collapses an expanded folder with ArrowLeft', () => {
    expect(nextTreeNavState(rows, idx('/p/a'), 'ArrowLeft')).toEqual({ type: 'collapse' })
  })

  it('moves a collapsed folder to its parent with ArrowLeft', () => {
    const collapsed = rows.map((r) => (r.pathname === '/p/a/b' ? { ...r, expanded: false } : r))
    expect(nextTreeNavState(collapsed, idx('/p/a/b'), 'ArrowLeft')).toEqual({
      type: 'focus',
      index: idx('/p/a')
    })
  })

  it('moves a file to its owning folder with ArrowLeft', () => {
    expect(nextTreeNavState(rows, idx('/p/a/b/c.md'), 'ArrowLeft')).toEqual({
      type: 'focus',
      index: idx('/p/a/b')
    })
    expect(nextTreeNavState(rows, idx('/p/a/d.md'), 'ArrowLeft')).toEqual({
      type: 'focus',
      index: idx('/p/a')
    })
  })

  it('does nothing on ArrowLeft for a root-level row', () => {
    expect(nextTreeNavState(rows, idx('/p/z.md'), 'ArrowLeft')).toEqual({ type: 'none' })
  })
})

describe('nextTreeNavState — item actions', () => {
  it('opens a file and toggles a folder with Enter', () => {
    expect(nextTreeNavState(rows, idx('/p/z.md'), 'Enter')).toEqual({ type: 'open' })
    expect(nextTreeNavState(rows, idx('/p/a'), 'Enter')).toEqual({ type: 'toggle' })
  })

  it('maps F2 and Delete onto the focused row', () => {
    expect(nextTreeNavState(rows, idx('/p/z.md'), 'F2')).toEqual({ type: 'rename' })
    expect(nextTreeNavState(rows, idx('/p/z.md'), 'Delete')).toEqual({ type: 'remove' })
  })
})
