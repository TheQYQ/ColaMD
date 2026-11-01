import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PERF-01 (#GUI-B5) regression guard. The editor route became a lazy chunk, so
// the main process's `mt::bootstrap-editor` — sent right around
// did-finish-load — can arrive BEFORE app.vue mounted and registered the store
// listener, and Electron does not replay IPC: `init` then never flips and the
// window stays blank. The entry-chunk `bootstrapBuffer` module registers its
// listener at module evaluation (guaranteed to precede did-finish-load) and
// holds the config until `LISTEN_FOR_BOOTSTRAP_WINDOW` drains it.
//
// The "config arrives first" order below is the race this must never lose;
// the drain must fold it into the stores exactly like the live listener did.

interface IpcLike {
  handlers: Record<string, Array<(...args: unknown[]) => void>>
  on: (channel: string, handler: (...args: unknown[]) => void) => () => void
  send: (...args: unknown[]) => void
  invoke: (...args: unknown[]) => Promise<unknown>
  emit: (channel: string, ...args: unknown[]) => void
}

const ipcHandlers: Record<string, Array<(...args: unknown[]) => void>> = {}

const ipc: IpcLike = {
  handlers: ipcHandlers,
  on(channel, handler) {
    ;(ipcHandlers[channel] ??= []).push(handler)
    return () => undefined
  },
  send: () => undefined,
  invoke: () => Promise.resolve(null),
  emit(channel, ...args) {
    for (const handler of ipcHandlers[channel] ?? []) handler({}, ...args)
  }
}

const windowStub: {
  electron?: {
    process: { platform: string; env: Record<string, string> }
    ipcRenderer: IpcLike
  }
  path?: { sep: string }
  colamd?: Record<string, unknown>
} = {}

const bootstrapConfig = {
  addBlankTab: true,
  markdownList: [],
  lineEnding: 'lf',
  sideBarVisibility: false,
  tabBarVisibility: true,
  sourceCodeModeEnabled: false,
  welcomeMarkdown: ''
}

const importStores = async () => {
  const [{ useEditorStore }, { useMainStore }] = await Promise.all([
    import('@/store/editor'),
    import('@/store')
  ])
  return { useEditorStore, useMainStore }
}

describe('bootstrap editor: the early-arrival race', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const channel of Object.keys(ipcHandlers)) delete ipcHandlers[channel]
    windowStub.electron = {
      process: { platform: 'win32', env: { COLAMD_VERSION_STRING: 'vTest' } },
      ipcRenderer: ipc
    }
    windowStub.path = { sep: '/' }
    ;(globalThis as unknown as { window: unknown }).window = windowStub
    setActivePinia(createPinia())
  })

  it('applies a bootstrap that arrived before the listener registered', async () => {
    // Entry chunk evaluates: the buffer module registers its listener.
    await import('@/bootstrapBuffer')
    // Main sends the bootstrap while the lazy route chunk is still loading.
    ipc.emit('mt::bootstrap-editor', bootstrapConfig)

    const { useEditorStore, useMainStore } = await importStores()
    const store = useEditorStore()
    store.LISTEN_FOR_BOOTSTRAP_WINDOW()

    expect(useMainStore().init).toBe(true)
    expect(store.tabs.length).toBe(1)
  })

  it('still applies a bootstrap that arrives after mounting (live listener intact)', async () => {
    await import('@/bootstrapBuffer')
    const { useEditorStore, useMainStore } = await importStores()
    const store = useEditorStore()
    store.LISTEN_FOR_BOOTSTRAP_WINDOW()

    ipc.emit('mt::bootstrap-editor', bootstrapConfig)

    expect(useMainStore().init).toBe(true)
    expect(store.tabs.length).toBe(1)
  })
})
