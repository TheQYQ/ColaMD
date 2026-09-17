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

// Commit f4f4a13 dropped the search tab from the sidebar while leaving the menu
// item, the command palette entry, the keyboard shortcut and `search.vue` in
// place. `search.vue` is the only listener of the `findInFolder` bus event, so
// without the tab the whole "Find in Folder" feature resolved to a no-op. The
// sidebar panel contract is 文件 / 目录 / 搜索 — history was retired, search
// was not.
describe('built-in sidebar tab set', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps the search tab so "Find in Folder" has a destination', () => {
    const ids = sideBarTabs.map((tab) => tab.id)

    expect(ids).toContain('search')
    expect(ids).toContain('files')
    expect(ids).toContain('toc')
  })

  it('exposes the search tab through the merged tab list', () => {
    const ids = getAllSideBarTabs().map((tab) => tab.id)

    expect(ids).toContain('search')
  })

  it('renders the search tab from its own translation key', () => {
    const searchTab = sideBarTabs.find((tab) => tab.id === 'search')

    expect(searchTab?.name()).toBe('Search')
  })

  it('no longer offers a history tab', () => {
    expect(sideBarTabs.some((tab) => tab.id === 'history')).toBe(false)
    expect(getAllSideBarTabs().some((tab) => tab.id === 'history')).toBe(false)
  })
})
