import { afterEach, describe, expect, it, vi } from 'vitest'
import QuickOpenCommand from '@/commands/quickOpen'

// O1 regression guard. Quick open must ask the main process for a FILE-NAME
// listing (`mode: 'files'`), because it fuzzy-matches file paths client-side.
// Wiring the default export of ripgrepSearcher instead of the named
// `FileSearcher` silently switched this to a full-text search whose match
// payloads are line records, not paths — so Ctrl+P returned nothing useful in
// folders whose file names did not contain the query. The break this catches:
// the searcher that QuickOpen talks to changes from name-mode to text-mode.

const ROOT = '/project/root'

interface RipgrepRequest {
  searchId: string
  mode: string
  directories: string[]
  pattern: string
  options: Record<string, unknown>
}

type Listener = (payload: unknown) => void

// Mirrors the `window.ripgrep` bridge in src/preload/index.ts one-for-one, so
// the real searcher code drives it exactly as it drives the production bridge.
function installRipgrepBridge(): { requests: RipgrepRequest[] } {
  const requests: RipgrepRequest[] = []
  const listeners = new Map<string, Set<Listener>>()
  const on = (channel: string, fn: Listener): (() => void) => {
    const bucket = listeners.get(channel) ?? new Set<Listener>()
    listeners.set(channel, bucket)
    bucket.add(fn)
    return () => {
      bucket.delete(fn)
    }
  }
  const emit = (channel: string, payload: unknown): void => {
    listeners.get(channel)?.forEach((fn) => fn(payload))
  }

  const bridge = {
    start: (req: unknown): Promise<unknown> => {
      requests.push(req as RipgrepRequest)
      // The client ignores any envelope whose searchId isn't its own, so the
      // bridge mirrors that shape (src/renderer/src/node/ripgrepSearcher.ts
      // `onDone`) and settles the search with an empty result set.
      queueMicrotask(() => emit('done', { searchId: (req as RipgrepRequest).searchId }))
      return Promise.resolve(undefined)
    },
    cancel: (): void => {},
    onMatch: (fn: Listener) => on('match', fn),
    onProgress: (fn: Listener) => on('progress', fn),
    onDone: (fn: Listener) => on('done', fn),
    onError: (fn: Listener) => on('error', fn),
    onCancelled: (fn: Listener) => on('cancelled', fn)
  }

  window.ripgrep = bridge as unknown as typeof window.ripgrep
  return { requests }
}

describe('quick open file-name search', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as unknown as { ripgrep: unknown }).ripgrep
    delete (window as unknown as { fileUtils: unknown }).fileUtils
  })

  it('asks the ripgrep bridge for files mode over the project root', async () => {
    const { requests } = installRipgrepBridge()
    window.fileUtils = {
      hasMarkdownExtension: () => false,
      MARKDOWN_INCLUSIONS: ['.md', '.markdown']
    } as unknown as typeof window.fileUtils

    const quickOpen = new QuickOpenCommand({
      editor: { tabs: [] },
      project: { projectTree: { pathname: ROOT } }
    } as unknown as ConstructorParameters<typeof QuickOpenCommand>[0])

    const result = await quickOpen._doSearch('alph')

    expect(result).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0].mode).toBe('files')
    expect(requests[0].directories).toEqual([ROOT])
  })
})
