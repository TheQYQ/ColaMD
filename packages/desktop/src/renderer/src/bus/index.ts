import mitt, { type Emitter } from 'mitt'
import type { IpcMainEventChannels } from '@shared/types/ipc'

// NOTE: We intentionally use mitt's default (string → unknown) event map.
// mitt is strictly single-arg (`emit(type, event)`), so a tuple/unknown[]
// payload shape would require wrapping every existing emit call in an
// array, changing runtime semantics. As individual events are typed in
// later commits, we can swap to a tuple-aware wrapper.
const emitter: Emitter<Record<string, unknown>> = mitt()

type BusHandler = (payload: unknown) => void

// mitt's emit has no try/catch (v3), so one listener throwing synchronously
// would drop every later listener of that event — `file-changed` has two —
// and climb back into the IPC callback that emitted it. Isolate at
// subscription time instead; `off` keeps working because each original
// handler maps to exactly one wrapped copy (WeakMap).
const wrapped = new WeakMap<BusHandler, BusHandler>()
const isolate = (type: string, fn: BusHandler): BusHandler => {
  let w = wrapped.get(fn)
  if (!w) {
    w = (payload: unknown): void => {
      try {
        fn(payload)
      } catch (err) {
        console.error(`[bus] listener for "${type}" threw:`, err)
      }
    }
    wrapped.set(fn, w)
  }
  return w
}

const bus = {
  // Live handler map, for tests and introspection: mitt stores the isolated
  // copies, so counts here reflect one entry per subscribe call.
  all: emitter.all,
  on: (type: string, fn: BusHandler): void => {
    emitter.on(type, isolate(type, fn))
  },
  off: (type: string, fn?: BusHandler): void => {
    emitter.off(type, fn ? (wrapped.get(fn) ?? fn) : undefined)
  },
  emit: (type: string, event?: unknown): void => {
    emitter.emit(type, event)
  }
}

export default bus

// Subscribe a menu action on both channels that can trigger it: the main
// process (IPC) and the renderer itself (bus). IPC wraps the payload after
// the event argument; bus passes a single payload — forward the first IPC
// arg as the bus payload. Only for handlers whose payload shape matches.
export function listenBoth(channel: string, fn: (payload: unknown) => void): void {
  window.electron.ipcRenderer.on(
    channel as keyof IpcMainEventChannels,
    (_event, ...args: unknown[]) => fn(args[0])
  )
  bus.on(channel, fn)
}
