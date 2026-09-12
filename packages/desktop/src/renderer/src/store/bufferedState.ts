import debounce from 'lodash/debounce'
import { useEditorStore } from './editor'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'

// M1.4: the crash buffer used to rewrite every tab's full snapshot at a 1s
// debounce — for a 1MB document that meant a ~1MB structured-clone IPC plus a
// synchronous fsync'd file write on the main process after every micro-pause
// in typing. Two levers, no architecture change (WORKPLAN "先做 M1.4 降频"):
//  - throttle: trailing debounce 5s, capped at one send per 30s (maxWait) so
//    long typing sessions still persist periodically;
//  - signature gate: an O(tabs) snapshot signature (synthetic-history content
//    id + scalar fields — no string building) skips the IPC + write entirely
//    when nothing observable changed.
// Freshness trade-off: a crash during continuous typing loses at most ~30s of
// unsaved content instead of ~1s — strictly fresher than the old behavior,
// where a continuously-resetting debounce wrote nothing until a pause.
const BUFFERED_STATE_DEBOUNCE_MS = 5000
const BUFFERED_STATE_MAX_WAIT_MS = 30000
const BUFFERED_STATE_VERSION = 1

interface StoreCache {
  editorStore: ReturnType<typeof useEditorStore> | null
  projectStore: ReturnType<typeof useProjectStore> | null
  layoutStore: ReturnType<typeof useLayoutStore> | null
}

const stores: StoreCache = {
  editorStore: null,
  projectStore: null,
  layoutStore: null
}

export const createBufferedState = (): Record<string, unknown> | null => {
  if (!stores.editorStore) {
    stores.editorStore = useEditorStore()
  }
  if (!stores.projectStore) {
    stores.projectStore = useProjectStore()
  }
  if (!stores.layoutStore) {
    stores.layoutStore = useLayoutStore()
  }

  const editorState = stores.editorStore.CREATE_BUFFERED_STATE()
  if (!editorState) return null

  return {
    version: BUFFERED_STATE_VERSION,
    ...editorState,
    project: stores.projectStore?.CREATE_BUFFERED_STATE?.() || null,
    layout: stores.layoutStore?.CREATE_BUFFERED_STATE?.() || null
  }
}

export const sendBufferedState = (): Promise<unknown> => {
  if (!stores.editorStore) {
    stores.editorStore = useEditorStore()
  }
  // The crash buffer must never capture a stale snapshot: the engine applies
  // keystrokes on the next animation frame, so flush any pending batch before
  // serializing the store (see packages/muya/docs/tabMarkdown-readers.md R8).
  // A no-op when nothing is pending; harmless before the editor mounts.
  stores.editorStore.flushActiveEditor()

  // M1.4 signature gate: skip the IPC + durable write when the snapshot is
  // observationally unchanged. The signature is computed AFTER the flush so a
  // just-committed edit is reflected.
  const signature = computeBufferSignature(editorStateForSignature(stores.editorStore.$state))
  if (signature === lastSentSignature) {
    return Promise.resolve(false)
  }

  const snapshot = createBufferedState()
  if (snapshot) {
    lastSentSignature = signature
    return window.electron.ipcRenderer.invoke('update-buffer-state', snapshot)
  }

  return Promise.resolve(false)
}

let lastSentSignature: string | null = null

interface SignatureTab {
  id?: string
  isSaved?: boolean
  markdown?: unknown
  scrollTop?: number
  cursor?: unknown
  history?: { stack?: Array<{ id?: number | string }>; lastEditIndex?: number }
}

/**
 * O(tabs) snapshot signature — deliberately avoids stringifying the markdown
 * bodies. Content changes are caught through the synthetic-history content id
 * (updated on every pause-flush commit by the M1.2b pipeline); scalar deltas
 * (saved flag, markdown length, caret offsets/keys, scroll position) are
 * folded in directly.
 */
export const computeBufferSignature = (state: unknown): string => {
  const s = state as
    | { tabs?: SignatureTab[]; currentFileId?: string; restoreWarnings?: unknown[] }
    | null
    | undefined
  if (!s || !Array.isArray(s.tabs)) return 'invalid'

  const tabs = s.tabs
    .map((tab) => {
      if (!tab) return 'null'
      const stack = tab.history?.stack
      const lastEditIndex = tab.history?.lastEditIndex
      const contentId =
        typeof lastEditIndex === 'number' && stack ? stack[lastEditIndex]?.id ?? 'u' : 'u'
      const cursor = tab.cursor as
        | { anchor?: { key?: unknown; offset?: unknown }; focus?: { key?: unknown; offset?: unknown } }
        | null
        | undefined
      return [
        tab.id ?? '',
        tab.isSaved ? 1 : 0,
        typeof tab.markdown === 'string' ? tab.markdown.length : -1,
        String(contentId),
        tab.scrollTop ?? '',
        cursor?.anchor?.key ?? '',
        cursor?.anchor?.offset ?? '',
        cursor?.focus?.key ?? '',
        cursor?.focus?.offset ?? ''
      ].join(':')
    })
    .join('|')

  return `${s.currentFileId ?? ''}#${tabs}#${Array.isArray(s.restoreWarnings) ? s.restoreWarnings.length : 0}`
}

const editorStateForSignature = (state: unknown): unknown => state

export const debouncedSendBufferedState = debounce(
  () => {
    sendBufferedState().catch((err) => {
      console.error('Failed to update buffered state', err)
    })
  },
  BUFFERED_STATE_DEBOUNCE_MS,
  { maxWait: BUFFERED_STATE_MAX_WAIT_MS }
)
