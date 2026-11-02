import { describe, expect, it, vi } from 'vitest'
import { createSendGate } from '../../../src/main/windows/sendGate'

// PERF-01 (#GUI-B5) follow-up. Making the editor route a lazy chunk moved
// `app.vue`'s `onMounted` — where every `mt::*` listener is registered — to an
// unpredictable point AFTER `did-finish-load`. The main process sends the
// bootstrap config and the CLI-opened documents from inside that event, and
// Electron does not replay IPC, so a message that lands in the gap is dropped
// for good: the window paints its empty state and never gets a tab.
//
// The gate holds every such send until the renderer announces that its
// listeners exist. The fallback timer that releases a renderer which never
// announces lives in the window, not here — which keeps this module pure.

describe('main->renderer send gate', () => {
  it('holds a send until the renderer announces readiness', () => {
    const gate = createSendGate()
    const send = vi.fn()

    gate.whenReady(send)
    expect(send).not.toHaveBeenCalled()

    gate.release()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('flushes queued sends in registration order', () => {
    const gate = createSendGate()
    const order: string[] = []

    gate.whenReady(() => order.push('bootstrap'))
    gate.whenReady(() => order.push('open-tab'))
    gate.release()

    expect(order).toEqual(['bootstrap', 'open-tab'])
  })

  it('sends immediately once the renderer is ready', () => {
    const gate = createSendGate()
    gate.release()

    const send = vi.fn()
    gate.whenReady(send)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('releases a queue only once, so a late readiness signal cannot re-apply it', () => {
    const gate = createSendGate()
    const send = vi.fn()

    gate.whenReady(send)
    gate.release()
    gate.release()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stops letting sends through when the window navigates again', () => {
    const gate = createSendGate()
    gate.release()

    gate.rearm()
    const send = vi.fn()
    gate.whenReady(send)
    expect(send).not.toHaveBeenCalled()

    gate.release()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps a send registered before navigation queued across the re-arm', () => {
    const gate = createSendGate()
    const send = vi.fn()

    gate.whenReady(send)
    gate.rearm()
    expect(send).not.toHaveBeenCalled()

    gate.release()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
