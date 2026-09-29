import { describe, expect, it, vi } from 'vitest'

// #26 item 4. `mt::close-window-confirm` answered "Save" with
// `Promise.all(...).then(() => close(window))`. `handleResponseForSave` never
// rejects -- a canceled dialog or a failed write resolves with nothing -- so the
// `.catch` below it (the one that asks "close anyway or keep the window open")
// was unreachable, and the window was destroyed with content that was never
// written. The policy is the predicate below: a tab counts as saved only if the
// helper handed its id back.

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { everyTabSaved } from 'main_renderer/utils'

const files = (ids: string[]) => ids.map((id) => ({ id }))

describe('everyTabSaved', () => {
  it('allows the window to close when every tab reported its saved id', () => {
    expect(everyTabSaved(['a', 'b'], files(['a', 'b']))).toBe(true)
  })

  it('blocks the close when one dialog was canceled', () => {
    expect(everyTabSaved(['a', undefined], files(['a', 'b']))).toBe(false)
  })

  it('blocks the close when one write failed', () => {
    // The failure path reports `mt::tab-save-failure` and resolves with nothing.
    expect(everyTabSaved([undefined, undefined], files(['a', 'b']))).toBe(false)
  })

  it('blocks the close when the results came back shorter than the request', () => {
    expect(everyTabSaved(['a'], files(['a', 'b']))).toBe(false)
  })

  it('treats an empty request as nothing to wait for', () => {
    expect(everyTabSaved([], files([]))).toBe(true)
  })
})
