import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `help.ts` imports `@/i18n`, whose module tail reads
// `window.electron.ipcRenderer.on` when present. Leave `window.electron` unset
// so that guard stays inert and the store graph never loads.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
  delete (w.window as { electron?: unknown }).electron
})

import { getAllSideBarTabs, sideBarTabs } from '@/components/sideBar/help'

// The sidebar panel contract is 文件 / 目录 / 版本历史 — the search panel was
// retired along with every "Find in Folder" entry point (menu item, command
// palette, keyboard shortcut), and the history tab is back for the version
// history panel (its read-side IPC was wired for real this time).
describe('built-in sidebar tab set', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('offers exactly the files, toc and history tabs', () => {
    const ids = sideBarTabs.map((tab) => tab.id)

    expect(ids).toContain('files')
    expect(ids).toContain('toc')
    expect(ids).toContain('history')
    expect(ids).toHaveLength(3)
  })

  it('exposes the same three tabs through the merged tab list', () => {
    const ids = getAllSideBarTabs().map((tab) => tab.id)

    expect(ids).toContain('files')
    expect(ids).toContain('toc')
    expect(ids).toContain('history')
  })

  it('no longer offers a search tab', () => {
    expect(sideBarTabs.some((tab) => tab.id === 'search')).toBe(false)
    expect(getAllSideBarTabs().some((tab) => tab.id === 'search')).toBe(false)
  })
})
