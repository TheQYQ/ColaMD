import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PERF-01 (#GUI-B5). The editor route is a lazy chunk now, so `app.vue`'s
// `onMounted` — where every `mt::*` handler is registered — runs at an
// unpredictable point after `did-finish-load`. Electron does not replay IPC, so
// a config sent into that gap is dropped for good and the window keeps its
// empty state.
//
// The fix is not a renderer-side buffer: the main process holds these sends
// until the page reports `mt::renderer-ready` (windows/sendGate.ts, covered by
// window-send-gate.spec.ts and window-manager-renderer-ready.spec.ts). What is
// left to prove from here is that the page does apply a config that arrives on
// the live channel, which is what every window now sees.

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

describe('bootstrap editor: the live channel', () => {
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

  it('applies a bootstrap that arrives after mounting', async () => {
    const [{ useEditorStore }, { useMainStore }] = await Promise.all([
      import('@/store/editor'),
      import('@/store')
    ])
    const store = useEditorStore()
    store.LISTEN_FOR_BOOTSTRAP_WINDOW()

    ipc.emit('mt::bootstrap-editor', bootstrapConfig)

    expect(useMainStore().init).toBe(true)
    expect(store.tabs.length).toBe(1)
  }, 15000) // Extended timeout: importing the whole store graph is slow under full-suite parallel load

  it('ignores a bootstrap that arrives before the listener is registered', async () => {
    const [{ useEditorStore }, { useMainStore }] = await Promise.all([
      import('@/store/editor'),
      import('@/store')
    ])
    const store = useEditorStore()

    ipc.emit('mt::bootstrap-editor', bootstrapConfig)

    // Recorded so the shape is visible from the suite: this is the ordering the
    // main-side send gate exists to make impossible.
    expect(useMainStore().init).toBe(false)
    expect(store.tabs.length).toBe(0)
  }, 15000) // Same reason: the first mounted-store import pays the module-graph cost
})
