import { describe, expect, it, vi } from 'vitest'
import bus from '@/bus'

// mitt's emit has no try/catch, so one listener throwing synchronously used
// to drop every later listener of the same event (`file-changed` has two)
// and climb back into the IPC callback that emitted. The bus now isolates
// each subscription.

describe('bus listener isolation', () => {
  it('a throwing listener does not break later listeners on the same event', () => {
    const later = vi.fn()
    bus.on('robustness-isolation', () => {
      throw new Error('boom')
    })
    bus.on('robustness-isolation', later)

    expect(() => bus.emit('robustness-isolation', { n: 1 })).not.toThrow()
    expect(later).toHaveBeenCalledWith({ n: 1 })
  })

  it('off still removes the isolated listener', () => {
    const fn = vi.fn()
    bus.on('robustness-off', fn)
    bus.off('robustness-off', fn)

    bus.emit('robustness-off', {})
    expect(fn).not.toHaveBeenCalled()
  })
})
