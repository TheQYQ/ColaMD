import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The layout action round-trips through the preload bridge (sidebar menu
// sync + preference persistence). Stub the bridge and the buffered-state
// debounce so no real IPC or timers are involved.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn()
}))

import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'

describe('layout SHOW_TOC_FOR_OPENED_FILE (auto-show TOC on file open)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('reveals the sidebar with the TOC tab when the preference is on', () => {
    const layout = useLayoutStore()
    expect(layout.showSideBar).toBe(false)

    layout.SHOW_TOC_FOR_OPENED_FILE('/notes/README.md')

    expect(layout.showSideBar).toBe(true)
    expect(layout.rightColumn).toBe('toc')
  })

  it('does nothing when the autoShowToc preference is off', () => {
    const layout = useLayoutStore()
    const preferences = usePreferencesStore()
    preferences.autoShowToc = false

    layout.SHOW_TOC_FOR_OPENED_FILE('/notes/README.md')

    // Store defaults: sidebar hidden, tree tab selected.
    expect(layout.showSideBar).toBe(false)
    expect(layout.rightColumn).toBe('files')
  })

  it('ignores untitled blanks without a pathname', () => {
    const layout = useLayoutStore()

    layout.SHOW_TOC_FOR_OPENED_FILE(undefined)

    expect(layout.showSideBar).toBe(false)
    expect(layout.rightColumn).toBe('files')
  })

  it('is a no-op when the TOC tab is already on screen', () => {
    const layout = useLayoutStore()
    layout.SHOW_TOC_FOR_OPENED_FILE('/notes/README.md')

    // A redundant call must not resurrect hidden state after the user (or a
    // later preference sync) turned the preference off mid-session.
    usePreferencesStore().autoShowToc = false
    layout.SHOW_TOC_FOR_OPENED_FILE('/notes/README.md')

    expect(layout.showSideBar).toBe(true)
    expect(layout.rightColumn).toBe('toc')
  })
})
