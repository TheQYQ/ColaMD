import { describe, expect, it, vi } from 'vitest'

// bufferedState pulls in the pinia stores, which read `window.path` /
// `window.electron` at module load; stub those surfaces first.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: Record<string, unknown>
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; invoke: (...a: unknown[]) => unknown; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= {}
  w.window.electron ??= {
    ipcRenderer: { send: () => {}, invoke: () => Promise.resolve(false), on: () => {} }
  }
})

vi.mock('@/store/project', () => ({ useProjectStore: () => ({ CREATE_BUFFERED_STATE: () => null }) }))
vi.mock('@/store/layout', () => ({ useLayoutStore: () => ({ CREATE_BUFFERED_STATE: () => null }) }))

import { computeBufferSignature } from '@/store/bufferedState'

// M1.4 — the crash-buffer signature gate: an O(tabs) signature (no markdown
// stringification) that must change whenever anything observable in the
// snapshot changes, and stay stable when nothing did.
const tab = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  isSaved: true,
  markdown: 'hello world',
  scrollTop: 0,
  cursor: { anchor: { key: 'k1', offset: 0 }, focus: { key: 'k1', offset: 0 } },
  history: { stack: [{ id: 5 }], lastEditIndex: 0 },
  ...overrides
})

const state = (tabs: unknown[], currentFileId = 'tab-1') => ({
  currentFileId,
  tabs,
  restoreWarnings: []
})

describe('computeBufferSignature', () => {
  it('is stable for identical snapshots', () => {
    expect(computeBufferSignature(state([tab()]))).toBe(computeBufferSignature(state([tab()])))
  })

  it('changes when the synthetic content id changes (same-length edit)', () => {
    const before = computeBufferSignature(state([tab()]))
    const after = computeBufferSignature(state([tab({ history: { stack: [{ id: 6 }], lastEditIndex: 0 } })]))
    expect(after).not.toBe(before)
  })

  it('changes when markdown length, saved flag, cursor or scroll change', () => {
    const base = computeBufferSignature(state([tab()]))
    expect(computeBufferSignature(state([tab({ markdown: 'hello worlds' })]))).not.toBe(base)
    expect(computeBufferSignature(state([tab({ isSaved: false })]))).not.toBe(base)
    expect(
      computeBufferSignature(state([tab({ cursor: { anchor: { key: 'k1', offset: 3 }, focus: { key: 'k1', offset: 3 } } })]))
    ).not.toBe(base)
    expect(computeBufferSignature(state([tab({ scrollTop: 100 })]))).not.toBe(base)
  })

  it('changes when the current tab or warning set changes', () => {
    const base = computeBufferSignature(state([tab()]))
    expect(computeBufferSignature(state([tab()], 'tab-2'))).not.toBe(base)
    expect(computeBufferSignature({ ...state([tab()]), restoreWarnings: [{ tabId: 'x' }] })).not.toBe(base)
  })

  it('handles invalid and empty shapes without throwing', () => {
    expect(computeBufferSignature(null)).toBe('invalid')
    expect(computeBufferSignature({})).toBe('invalid')
    expect(typeof computeBufferSignature(state([]))).toBe('string')
  })
})
