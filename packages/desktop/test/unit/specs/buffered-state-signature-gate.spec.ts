import { beforeEach, describe, expect, it, vi } from 'vitest'

// #26 item 2, renderer half. `sendBufferedState()` recorded the snapshot
// signature *before* it knew whether main's durable write landed, so a failed
// write was never retried: the next call matched the recorded signature, was
// skipped, and the crash buffer silently kept the older content. The signature
// is now committed only on a truthy answer -- which also means the gate still
// does its job when writes succeed.

const invoke = vi.fn<(channel: string, payload: unknown) => Promise<unknown>>()

vi.stubGlobal('window', {
  electron: { ipcRenderer: { invoke } },
  path: { sep: '/' }
})

vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({
    $state: { currentFileId: 'tab-1', tabs: [{ id: 'tab-1', isSaved: false, markdown: 'x' }] },
    flushActiveEditor: () => {},
    CREATE_BUFFERED_STATE: () => ({ tabs: [{ id: 'tab-1' }] })
  })
}))
vi.mock('@/store/project', () => ({
  useProjectStore: () => ({ CREATE_BUFFERED_STATE: () => null })
}))
vi.mock('@/store/layout', () => ({
  useLayoutStore: () => ({ CREATE_BUFFERED_STATE: () => null })
}))

// `lastSentSignature` is module state, so each case needs a fresh copy of the
// module -- otherwise one case's committed signature leaks into the next and the
// file only passes in one particular order (the shape §14.1 of PROJECT_GUIDE
// just finished documenting for the e2e suite).
const loadSendBufferedState = async () => {
  vi.resetModules()
  const mod = await import('@/store/bufferedState')
  return mod.sendBufferedState
}

describe('the crash-buffer signature gate', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('sends again after main reports the write did not land', async () => {
    const sendBufferedState = await loadSendBufferedState()
    invoke.mockResolvedValue(false)

    await sendBufferedState()
    await sendBufferedState()

    // Unchanged state, unwritable disk: the second call must still try, or the
    // buffer stays stale until the next keystroke.
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('still skips the send when the snapshot is unchanged and the write landed', async () => {
    const sendBufferedState = await loadSendBufferedState()
    invoke.mockResolvedValue(true)

    await sendBufferedState()
    await sendBufferedState()

    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
