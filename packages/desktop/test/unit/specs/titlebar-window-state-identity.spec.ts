import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computed, ref, watch } from 'vue'
import { loadSfcSetup } from '../sfcScriptHarness'

// Round 6 of the stability audit: `titleBar/index.vue` reads the window state once
// on mount and writes it back unguarded, while four main-process event handlers
// write the very same refs:
//
//   const offMaximize = window.electron.ipcRenderer.on('mt::window-maximize', onMaximize)
//   // ... registered at setup top level (:212-221), i.e. BEFORE onMounted fires
//   onMounted(async () => {
//     const [fs, max] = await Promise.all([isFullScreen(), isMaximized()])
//     isFullScreen.value = !!fs      // <- no guard
//     isMaximized.value = !!max
//   })
//
// Because the listeners attach first, "event arrives, then the query answer
// lands" is the DEFAULT order, not an exotic one. The concrete trigger is a
// window the window manager restores as maximized: `mt::window-maximize` sets the
// ref to true, then the in-flight query — which asked before the restore — answers
// `false` and overwrites it. The glyph is then wrong until the next real
// maximize/unmaximize.
//
// Both awaits are settled by hand here, so the ordering is provable rather than
// timed. Driven through the real `<script setup>` (`loadSfcSetup`), same harness as
// `history-clear-identity.spec.ts`.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/titleBar/index.vue')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

interface Bindings {
  isFullScreen: { value: boolean }
  isMaximized: { value: boolean }
  __returned__?: Bindings
}

const boot = () => {
  const fullScreenAnswer = deferred<boolean>()
  const maximizedAnswer = deferred<boolean>()
  const ipcHandlers = new Map<string, (event: unknown, ...rest: unknown[]) => void>()
  const mountedCallbacks: (() => unknown)[] = []

  ;(globalThis as unknown as { window: unknown }).window = {
    electron: {
      windowControl: {
        isFullScreen: () => fullScreenAnswer.promise,
        isMaximized: () => maximizedAnswer.promise,
        close: () => {},
        maximize: () => {},
        unmaximize: () => {},
        setFullScreen: () => {}
      },
      // The real preload returns an unsubscribe function; the component stores it
      // and calls it in `onBeforeUnmount`.
      ipcRenderer: {
        on: (channel: string, handler: (event: unknown, ...rest: unknown[]) => void) => {
          ipcHandlers.set(channel, handler)
          return () => ipcHandlers.delete(channel)
        }
      }
    }
  }

  const titleBarStyle = ref('custom')
  const showTabBar = ref(true)

  const deps = {
    // `compileScript` wraps the setup in `_defineComponent`; the harness injects
    // exactly the names present in this object, so anything the compiled output
    // evaluates has to be listed here or it throws at load time.
    _defineComponent: (o: unknown) => o,
    usePreferencesStore: () => ({}),
    useLayoutStore: () => ({}),
    useEditorStore: () => ({}),
    ref,
    computed,
    watch,
    // Capture instead of running: the spec starts the mount query explicitly, so
    // the awaits inside it are the only thing in flight.
    onMounted: (cb: () => unknown) => {
      mountedCallbacks.push(cb)
    },
    onBeforeUnmount: () => {},
    storeToRefs: () => ({ titleBarStyle, showTabBar }),
    minimizePath: 'min',
    restorePath: 'restore',
    maximizePath: 'max',
    closePath: 'close',
    isOsxPlatform: false,
    shouldShowInAppTitleBar: () => true
  }

  const setup = loadSfcSetup<Bindings>(vuePath, deps)
  const raw = setup({ filename: 'a.md', project: undefined }, { expose: () => {} })
  const bindings = (raw.__returned__ ?? raw) as Bindings

  const emit = (channel: string): void => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`no handler registered for ${channel}`)
    handler({})
  }

  return {
    bindings,
    mountedCallbacks,
    fullScreenAnswer,
    maximizedAnswer,
    emit,
    handlers: ipcHandlers
  }
}

describe('title bar window state: the mount query must not overwrite a newer event', () => {
  it('keeps the maximized flag when mt::window-maximize arrives before the query answers', async () => {
    const { bindings, mountedCallbacks, maximizedAnswer, fullScreenAnswer, emit } = boot()

    // The four listeners attach during setup, ahead of the mount query.
    expect(() => emit('mt::window-maximize')).not.toThrow()

    // The mount query starts and is still in flight.
    expect(mountedCallbacks).toHaveLength(1)
    void mountedCallbacks[0]()

    // The window manager maximizes the window while the query is in flight.
    emit('mt::window-maximize')
    expect(bindings.isMaximized.value).toBe(true)

    // The query answers with what it saw BEFORE the maximize.
    maximizedAnswer.resolve(false)
    fullScreenAnswer.resolve(false)
    await maximizedAnswer.promise
    await fullScreenAnswer.promise
    await Promise.resolve()

    expect(bindings.isMaximized.value).toBe(true)
  })

  it('keeps the full-screen flag when mt::window-enter-full-screen arrives first', async () => {
    const { bindings, mountedCallbacks, maximizedAnswer, fullScreenAnswer, emit } = boot()
    void mountedCallbacks[0]()

    emit('mt::window-enter-full-screen')
    expect(bindings.isFullScreen.value).toBe(true)

    fullScreenAnswer.resolve(false)
    maximizedAnswer.resolve(false)
    await fullScreenAnswer.promise
    await maximizedAnswer.promise
    await Promise.resolve()

    expect(bindings.isFullScreen.value).toBe(true)
  })

  it('still applies the mount answer when no event overtook it (positive control)', async () => {
    const { bindings, mountedCallbacks, maximizedAnswer, fullScreenAnswer } = boot()
    expect(bindings.isMaximized.value).toBe(false)

    void mountedCallbacks[0]()
    maximizedAnswer.resolve(true)
    fullScreenAnswer.resolve(false)
    await maximizedAnswer.promise
    await fullScreenAnswer.promise
    await Promise.resolve()

    expect(bindings.isMaximized.value).toBe(true)
    expect(bindings.isFullScreen.value).toBe(false)
  })

  it('still honours a later unmaximize after the mount answer landed', async () => {
    // Guards the fix against over-correcting into "once an event is seen, the
    // query is ignored forever".
    const { bindings, mountedCallbacks, maximizedAnswer, fullScreenAnswer, emit } = boot()

    void mountedCallbacks[0]()
    maximizedAnswer.resolve(true)
    fullScreenAnswer.resolve(true)
    await maximizedAnswer.promise
    await fullScreenAnswer.promise
    await Promise.resolve()
    expect(bindings.isMaximized.value).toBe(true)

    emit('mt::window-unmaximize')
    expect(bindings.isMaximized.value).toBe(false)
  })
})
