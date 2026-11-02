/**
 * Holds main->renderer sends until that renderer has registered its listeners.
 *
 * `did-finish-load` no longer implies the editor route has been evaluated —
 * #GUI-B5 turned it into a lazy chunk — and the `mt::*` handlers live in
 * `app.vue`'s `onMounted`. Electron does not replay IPC, so anything sent into
 * that gap is dropped for good: the window paints, the document never opens,
 * and the user sees the empty state with no tab.
 */
export interface SendGate {
  /** Run `send` now when the renderer is ready, otherwise queue it. */
  whenReady: (send: () => void) => void
  /** Flush the queue in order. Idempotent, so a late signal is harmless. */
  release: () => void
  /** A navigation started again: hold sends until the next `release`. */
  rearm: () => void
}

export const createSendGate = (): SendGate => {
  let ready = false
  const queue: Array<() => void> = []

  return {
    whenReady: (send: () => void): void => {
      if (ready) send()
      else queue.push(send)
    },
    release: (): void => {
      if (ready) return
      ready = true
      for (const send of queue.splice(0, queue.length)) send()
    },
    rearm: (): void => {
      ready = false
    }
  }
}
