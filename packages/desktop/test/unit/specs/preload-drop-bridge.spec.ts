import { describe, expect, it, vi } from 'vitest'

import {
  DROP_CHANNEL,
  collectDropPaths,
  installDropBridge,
  isPageSendAllowed
} from '../../../src/preload/dropBridge'

// The drop trust anchor (batch B): mt::window::drop used to be a page-sendable
// channel, so a compromised renderer could forge dropped paths and make
// openFileOrFolder grant the parent dir of any existing file. Verified by
// spike (2026-10-06, electron 42): webUtils.getPathForFile returns "" for
// JS-constructed Files — including filenames carrying absolute paths — while
// a preload-isolated-world 'drop' listener does receive DOM drop events. So
// the preload computes paths from real drops and is the only allowed sender;
// the page-facing send wrapper blocks the channel.

const fakeDataTransfer = (files: unknown[]): DataTransfer => ({ files }) as unknown as DataTransfer

describe('isPageSendAllowed', () => {
  it('blocks the page from sending mt::window::drop', () => {
    expect(isPageSendAllowed(DROP_CHANNEL)).toBe(false)
  })

  it('still allows every other channel through', () => {
    expect(isPageSendAllowed('mt::open-file')).toBe(true)
    expect(isPageSendAllowed('mt::window-tab-closed')).toBe(true)
    expect(isPageSendAllowed('menu-clear-recently-used')).toBe(true)
  })
})

describe('collectDropPaths', () => {
  it('collects the paths of dropped files in order', () => {
    const getPathForFile = vi.fn((f: File) => `/real/${f.name}`)
    const dt = fakeDataTransfer([new File(['a'], 'a.md'), new File(['b'], 'b.md')])

    expect(collectDropPaths(dt, getPathForFile)).toEqual(['/real/a.md', '/real/b.md'])
  })

  it('drops entries with no native path (synthetic files report "")', () => {
    const getPathForFile = (): string => ''
    const dt = fakeDataTransfer([new File(['x'], 'C:\\evil\\victim.md')])

    expect(collectDropPaths(dt, getPathForFile)).toEqual([])
  })

  it('skips files whose path lookup throws instead of failing the whole drop', () => {
    const getPathForFile = (f: File): string => {
      if (f.name === 'bad') throw new Error('not a native file')
      return `/real/${f.name}`
    }
    const dt = fakeDataTransfer([new File(['x'], 'bad'), new File(['y'], 'good.md')])

    expect(collectDropPaths(dt, getPathForFile)).toEqual(['/real/good.md'])
  })

  it('returns nothing when there is no dataTransfer (text/link drops)', () => {
    expect(collectDropPaths(null, () => '/x')).toEqual([])
    expect(collectDropPaths(undefined, () => '/x')).toEqual([])
  })

  it('falls back to dataTransfer.items when the files list is empty', () => {
    const asFile = new File(['z'], 'from-items.md')
    const dt = {
      files: [],
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => asFile }
      ]
    } as unknown as DataTransfer
    const getPathForFile = vi.fn((f: File) => `/real/${f.name}`)

    expect(collectDropPaths(dt, getPathForFile)).toEqual(['/real/from-items.md'])
    expect(getPathForFile).toHaveBeenCalledWith(asFile)
  })
})

describe('installDropBridge', () => {
  const dispatchDrop = (target: EventTarget, dt: DataTransfer | null): void => {
    const ev = new Event('drop')
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    target.dispatchEvent(ev)
  }

  it('sends collected paths when a drop carries real files', () => {
    const send = vi.fn()
    const target = new EventTarget()
    installDropBridge(target, {
      getPathForFile: (f: File) => `/real/${f.name}`,
      send
    })

    dispatchDrop(target, fakeDataTransfer([new File(['a'], 'a.md')]))

    expect(send).toHaveBeenCalledWith(['/real/a.md'])
  })

  it('stays silent when the drop yields no native paths', () => {
    const send = vi.fn()
    const target = new EventTarget()
    installDropBridge(target, { getPathForFile: () => '', send })

    dispatchDrop(target, fakeDataTransfer([new File(['x'], 'forged.md')]))

    expect(send).not.toHaveBeenCalled()
  })
})
