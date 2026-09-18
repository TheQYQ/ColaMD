import mitt, { type Emitter } from 'mitt'
import type { IpcMainEventChannels } from '@shared/types/ipc'

// NOTE: We intentionally use mitt's default (string → unknown) event map.
// mitt is strictly single-arg (`emit(type, event)`), so a tuple/unknown[]
// payload shape would require wrapping every existing emit call in an
// array, changing runtime semantics. As individual events are typed in
// later commits, we can swap to a tuple-aware wrapper.
const emitter: Emitter<Record<string, unknown>> = mitt()

export default emitter

// Subscribe a menu action on both channels that can trigger it: the main
// process (IPC) and the renderer itself (bus). IPC wraps the payload after
// the event argument; bus passes a single payload — forward the first IPC
// arg as the bus payload. Only for handlers whose payload shape matches.
export function listenBoth(channel: string, fn: (payload: unknown) => void): void {
  window.electron.ipcRenderer.on(
    channel as keyof IpcMainEventChannels,
    (_event, ...args: unknown[]) => fn(args[0])
  )
  emitter.on(channel, fn)
}
