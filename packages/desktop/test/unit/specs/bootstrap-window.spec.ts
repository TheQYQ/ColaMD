import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// O12(5): APPLY_BOOTSTRAP_EDITOR is the first thing a fresh window does, and the
// reason it was split out of LISTEN_FOR_BOOTSTRAP_WINDOW is that nothing below an
// ipcRenderer.on callback could be tested. These cases pin both halves: the order
// the launch config is folded into the other stores, and the tabs it ends up
// opening.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
        process: { platform: string; env: Record<string, string> }
      }
      colamd?: unknown
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {}, invoke: () => Promise.resolve('') },
    process: { platform: 'win32', env: { COLAMD_VERSION: '0.0.0-test' } }
  }
  w.window.colamd ??= { env: { windowId: 1 } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(false))
}))

import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { useMainStore } from '@/store'
import { usePreferencesStore } from '@/store/preferences'

const config = (over: Record<string, unknown> = {}) =>
  ({
    addBlankTab: false,
    markdownList: [],
    lineEnding: 'lf',
    sideBarVisibility: true,
    tabBarVisibility: true,
    sourceCodeModeEnabled: false,
    ...over
  }) as never

describe('useEditorStore.APPLY_BOOTSTRAP_EDITOR', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('marks initialized before folding preferences, layout and mode into place', () => {
    const editor = useEditorStore()
    const main = useMainStore()
    const preferences = usePreferencesStore()
    const layout = useLayoutStore()

    const initialized = vi.spyOn(main, 'SET_INITIALIZED')
    const preference = vi.spyOn(preferences, 'SET_USER_PREFERENCE')
    const setLayout = vi.spyOn(layout, 'SET_LAYOUT')
    const setMode = vi.spyOn(preferences, 'SET_MODE')

    editor.APPLY_BOOTSTRAP_EDITOR(config())

    const order = [
      initialized.mock.calls[0],
      preference.mock.calls[0],
      setLayout.mock.calls[0],
      setMode.mock.calls[0]
    ]
    expect(order.every(Boolean)).toBe(true)
    expect(initialized.mock.invocationCallOrder[0]).toBeLessThan(
      preference.mock.invocationCallOrder[0]
    )
    expect(preference.mock.invocationCallOrder[0]).toBeLessThan(
      setLayout.mock.invocationCallOrder[0]
    )
    expect(setLayout.mock.invocationCallOrder[0]).toBeLessThan(setMode.mock.invocationCallOrder[0])
    expect(preference).toHaveBeenCalledWith({ endOfLine: 'lf' })
    expect(setMode).toHaveBeenCalledWith({ type: 'sourceCode', checked: false })
  })

  it('seeds the first-run welcome document as the one selected tab', () => {
    const editor = useEditorStore()

    editor.APPLY_BOOTSTRAP_EDITOR(config({ welcomeMarkdown: '# welcome\n' }))

    expect(editor.tabs).toHaveLength(1)
    expect(editor.currentFile?.markdown).toBe('# welcome\n')
  })

  it('opens seeded documents with only the first selected', () => {
    const editor = useEditorStore()

    editor.APPLY_BOOTSTRAP_EDITOR(config({ markdownList: ['# one\n', '# two\n'] }))

    expect(editor.tabs.map((t) => t.markdown)).toEqual(['# one\n', '# two\n'])
    expect(editor.currentFile?.markdown).toBe('# one\n')
  })

  it('opens nothing when the window is restoring a session', () => {
    const editor = useEditorStore()

    editor.APPLY_BOOTSTRAP_EDITOR(config())

    expect(editor.tabs).toHaveLength(0)
    expect(editor.currentFile).toBeNull()
  })
})
