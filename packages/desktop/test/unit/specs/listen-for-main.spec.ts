import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `listenForMain` pulls in the bus module, which transitively imports the
// preferences store and `@/config` (the latter reads `window.path.sep` at
// module load). Stub the contextBridge surfaces before the hoisted imports run
// so the store graph can load.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

import { useListenForMainStore } from '@/store/listenForMain'
import bus from '@/bus'

// The renderer i18n module (pulled in via the preferences store) reads
// `window.electron.ipcRenderer` at import time. Provide spies for it.
const win = window as unknown as {
  electron?: { ipcRenderer: { on: Mock; send: Mock; invoke: Mock } }
  colamd?: { env: { windowId: number } }
}

describe('listenForMain store EDITOR_EDIT_ACTION', () => {
  beforeEach(() => {
    win.electron = {
      ipcRenderer: {
        on: vi.fn(),
        send: vi.fn(),
        invoke: vi.fn(() => Promise.resolve(false))
      }
    }
    win.colamd = { env: { windowId: 1 } }
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete win.electron
    delete win.colamd
    vi.clearAllMocks()
  })

  it('re-emits the edit action on the bus with the type as payload', () => {
    const emitSpy = vi.spyOn(bus, 'emit')

    useListenForMainStore().EDITOR_EDIT_ACTION('insertParagraph')

    expect(emitSpy).toHaveBeenCalledWith('insertParagraph', 'insertParagraph')
  })

  it('forwards every edit action type without filtering', () => {
    const emitSpy = vi.spyOn(bus, 'emit')

    useListenForMainStore().EDITOR_EDIT_ACTION('find')
    useListenForMainStore().EDITOR_EDIT_ACTION('replace')

    expect(emitSpy).toHaveBeenCalledWith('find', 'find')
    expect(emitSpy).toHaveBeenCalledWith('replace', 'replace')
  })
})
