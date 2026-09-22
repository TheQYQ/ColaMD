import { describe, expect, it } from 'vitest'
import bus from '@/bus'
import { bindEditorBus, unbindEditorBus } from '@/components/editorWithTabs/muyaBusEvents'

// The editor used to keep two hand-written lists of thirty-one `bus.on` /
// `bus.off` calls, one in `onMounted` and one in `onBeforeUnmount`. Nothing
// enforced that they stayed paired, so an added event could leak a handler onto
// the shared emitter for the life of the renderer. Binding and unbinding now
// take ONE object; this is the contract that object has to keep.

describe('editor bus bindings', () => {
  it('subscribes every entry and releases exactly the same set', () => {
    const fired: string[] = []
    const handlers = {
      'spec-zero-arg': () => fired.push('zero'),
      'spec-one-arg': (payload: unknown) => fired.push(`one:${String(payload)}`)
    }

    bindEditorBus(handlers)
    bus.emit('spec-zero-arg')
    bus.emit('spec-one-arg', 'x')
    expect(fired).toEqual(['zero', 'one:x'])

    unbindEditorBus(handlers)
    fired.length = 0
    bus.emit('spec-zero-arg')
    bus.emit('spec-one-arg', 'y')
    expect(fired).toEqual([])
  })

  it('leaves no listener behind on the shared emitter', () => {
    const handlers = { 'spec-cleaned-up': () => undefined }
    const before = bus.all.get('spec-cleaned-up')?.length ?? 0

    bindEditorBus(handlers)
    expect(bus.all.get('spec-cleaned-up')?.length).toBe(before + 1)

    unbindEditorBus(handlers)
    expect(bus.all.get('spec-cleaned-up')?.length ?? 0).toBe(before)
  })
})
