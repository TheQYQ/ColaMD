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

// The sidebar panel contract is 文件 / 目录 — both history (#f4f4a13) and
// search panels were retired, along with every "Find in Folder" entry point
// (menu item, command palette, keyboard shortcut).
describe('built-in sidebar tab set', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('offers only the files and toc tabs', () => {
    const ids = sideBarTabs.map((tab) => tab.id)

    expect(ids).toContain('files')
    expect(ids).toContain('toc')
    expect(ids).toHaveLength(2)
  })

  it('exposes the same two tabs through the merged tab list', () => {
    const ids = getAllSideBarTabs().map((tab) => tab.id)

    expect(ids).toContain('files')
    expect(ids).toContain('toc')
  })

  it('no longer offers a history tab', () => {
    expect(sideBarTabs.some((tab) => tab.id === 'history')).toBe(false)
    expect(getAllSideBarTabs().some((tab) => tab.id === 'history')).toBe(false)
  })

  it('no longer offers a search tab', () => {
    expect(sideBarTabs.some((tab) => tab.id === 'search')).toBe(false)
    expect(getAllSideBarTabs().some((tab) => tab.id === 'search')).toBe(false)
  })
})
