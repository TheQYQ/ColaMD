import { describe, expect, it, vi } from 'vitest'
import QuickOpenCommand from '@/commands/quickOpen'

// #28 item 4. `search()` returned the tab list straight away for an empty query,
// and that early return sat *above* the block that cancels whatever the previous
// keystroke started -- so clearing the box by backspacing left the directory
// scan running. The palette side of the same finding is pinned in
// command-palette-stale-results.spec.ts.

// `_doSearch` filters the open tabs through the preload bridge before it ever
// reaches the searcher, so the bridge has to exist here -- otherwise the call
// rejects with a TypeError and the case would be asserting nothing.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window: {
      fileUtils?: {
        isChildOfDirectory: (dir: string, sub: string) => boolean
        hasMarkdownExtension: (p: string) => boolean
        MARKDOWN_INCLUSIONS: string[]
      }
      path?: { relative: (from: string, to: string) => string }
    }
  }
  w.window.fileUtils = {
    isChildOfDirectory: () => true,
    hasMarkdownExtension: () => false,
    MARKDOWN_INCLUSIONS: ['.md']
  }
  w.window.path = { relative: (_from, to) => to }
})

interface SearcherOptions {
  didMatch: (path: string) => void
  didSearchPaths: (num: number) => void
}

type FakeSearcher = {
  search: (
    dirs: unknown,
    pattern: unknown,
    options: SearcherOptions
  ) => Promise<void> & { cancel?: () => void }
}

interface QuickOpenInternals {
  _directorySearcher: FakeSearcher
}

const commandWithRoot = (): QuickOpenCommand =>
  new QuickOpenCommand({
    editor: { tabs: [{ pathname: '/root/a.md' }] },
    project: { projectTree: { pathname: '/root' } }
  } as unknown as ConstructorParameters<typeof QuickOpenCommand>[0])

const withSearcher = (cmd: QuickOpenCommand, searcher: FakeSearcher): void => {
  ;(cmd as unknown as QuickOpenInternals)._directorySearcher = searcher
}

// A searcher that never finishes, the way a large root directory does.
const neverEndingSearch = (onCancel: () => void): FakeSearcher => ({
  search: (_dirs, _pattern, _options) =>
    Object.assign(new Promise<void>(() => {}), { cancel: onCancel })
})

// The debounce inside `search()` is a real 300 ms `delay`, so this waits past it
// rather than faking timers: what the cases measure is which search is live when
// the next keystroke arrives.
const pastDebounce = async (): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, 400))

describe('quick open: clearing the query', () => {
  it('cancels the directory search the previous keystroke started', async () => {
    const cmd = commandWithRoot()
    let canceled = false
    withSearcher(
      cmd,
      neverEndingSearch(() => (canceled = true))
    )

    void cmd.search('a')
    await pastDebounce()
    expect(canceled).toBe(false)

    await cmd.search('')
    expect(canceled).toBe(true)
  })

  it('keeps cancelling for a newer non-empty query', async () => {
    const cmd = commandWithRoot()
    let canceled = false
    withSearcher(
      cmd,
      neverEndingSearch(() => (canceled = true))
    )

    void cmd.search('a')
    await pastDebounce()
    void cmd.search('b')
    await pastDebounce()
    expect(canceled).toBe(true)
  })

  // The other half of the same dead handle: the ">30 files, ask the user to be
  // more specific" abort went through the chained promise too.
  it('aborts the scan once more than 30 paths have been found', async () => {
    const cmd = commandWithRoot()
    let canceled = false
    const reported: Array<(num: number) => void> = []
    withSearcher(cmd, {
      search: (_dirs, _pattern, options) => {
        reported.push(options.didSearchPaths)
        return Object.assign(new Promise<void>(() => {}), {
          cancel: () => {
            canceled = true
          }
        })
      }
    })

    void cmd.search('a')
    await pastDebounce()
    expect(reported).toHaveLength(1)
    reported[0]?.(31)
    expect(canceled).toBe(true)
  })
})
