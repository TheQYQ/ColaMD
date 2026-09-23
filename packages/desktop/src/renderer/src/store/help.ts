import type { IFileState } from '@shared/types/files'

// Structural view of the project store, so this helper does not have to import
// the store it is handed (and would import back).
export interface ProjectStoreLike {
  projectTree: { pathname?: string } | null
}
import { getUniqueId, deepClone } from '../util'

// Helper module (NOT a Pinia store): defaults and factories for the editor
// document state objects, plus the two pure helpers lifted out of `store/editor.ts`
// by O12 — the trailing-newline normalizer the save path runs and the
// crash-buffer format (see the section at the bottom of this file).

// Re-export the cross-process shape for convenience so renderer code can
// continue to import these from `./help`.
export type { IFileState }

const defaultFileStateWithoutId = {
  isSaved: true,
  pathname: '',
  filename: 'Untitled-1',
  markdown: '',
  encoding: {
    encoding: 'utf8',
    isBom: false
  },
  lineEnding: 'lf',
  trimTrailingNewline: 3,
  adjustLineEndingOnSave: false,
  history: {
    stack: [],
    index: -1
  },
  cursor: null,
  wordCount: {
    paragraph: 0,
    word: 0,
    character: 0,
    all: 0
  },
  searchMatches: {
    index: -1,
    matches: [],
    value: ''
  },
  scrollTop: 0,
  muyaIndexCursor: null,
  notifications: []
} satisfies Omit<IFileState, 'id'>

/**
 * Default internal markdown document with editor options. Acts as the
 * template for cloning into per-tab state. Note: `id` is intentionally
 * omitted — every actual file state must allocate a unique id via
 * `getBlankFileState` / `createDocumentState`.
 */
const defaultFileState: Omit<IFileState, 'id'> = defaultFileStateWithoutId

export const getOptionsFromState = (
  file: IFileState
): {
  encoding: IFileState['encoding']
  lineEnding: IFileState['lineEnding']
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
} => {
  const { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline } = file
  return { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline }
}

const documentStateKeys = [
  'isSaved',
  'pathname',
  'filename',
  'markdown',
  'encoding',
  'lineEnding',
  'trimTrailingNewline',
  'adjustLineEndingOnSave',
  'history',
  'cursor',
  'wordCount',
  'searchMatches',
  'scrollTop',
  'muyaIndexCursor',
  'notifications'
] as const satisfies ReadonlyArray<keyof IFileState>

export const getBlankFileState = (
  tabs: Array<{ pathname: string; filename: string }>,
  defaultEncoding: string = defaultFileStateWithoutId.encoding.encoding,
  lineEnding: string = defaultFileStateWithoutId.lineEnding,
  markdown: string | null = defaultFileStateWithoutId.markdown
): IFileState => {
  const fileState = deepClone(defaultFileStateWithoutId) as Omit<IFileState, 'id'>
  const defaultFilenamePrefix = defaultFileStateWithoutId.filename.split('-')[0]
  let untitleId = Math.max(
    ...tabs.map((f) => {
      if (f.pathname === '') {
        return +f.filename.split('-')[1]
      } else {
        return 0
      }
    }),
    0
  )

  const id = getUniqueId()

  // We may pass markdown=null as a parameter.
  if (markdown == null) {
    markdown = defaultFileStateWithoutId.markdown
  }

  fileState.encoding.encoding = defaultEncoding
  return Object.assign(fileState, {
    lineEnding,
    adjustLineEndingOnSave: lineEnding.toLowerCase() === 'crlf',
    id,
    filename: `${defaultFilenamePrefix}-${++untitleId}`,
    markdown,
    // The freshly-loaded document IS its on-disk/clean baseline. The engine
    // clears its undo history on `setContent`, so the baseline undo-stack depth
    // (the synthetic save-tracking id) is 0. Seeding `lastSavedHistoryId` to 0
    // (not -1) lets the dirty indicator clear again when an edit is undone back
    // to this baseline, even before the document has ever been saved.
    lastSavedHistoryId: 0
  }) as IFileState
}

/**
 * Creates an internal document from the given document. Accepts loosely
 * typed input (IPC payloads, partial states) and copies through the keys
 * documented by `documentStateKeys`.
 */
export const createDocumentState = (
  markdownDocument: Partial<IFileState> | Record<string, unknown> | null | undefined = {},
  id: string = getUniqueId()
): IFileState => {
  const src = (markdownDocument || {}) as Record<string, unknown>
  const docState = deepClone(defaultFileStateWithoutId) as Omit<IFileState, 'id'>

  for (const key of documentStateKeys) {
    if (src[key] !== undefined) {
      ;(docState as Record<string, unknown>)[key] = src[key]
    }
  }

  return Object.assign(docState, {
    id,
    // See `getBlankFileState`: the loaded document is its own clean baseline and
    // the engine's baseline undo-stack depth (the synthetic id) is 0.
    lastSavedHistoryId: 0
  }) as IFileState
}

export const getFileStateFromData = (
  data: Partial<IFileState> | Record<string, unknown> | null | undefined
): IFileState => createDocumentState(data)

// ---------------------------------------------------------------------------
// O12(2): lifted out of store/editor.ts verbatim. Two families: the trailing-
// newline normalizer the save path runs, and the crash-buffer format - the
// scalar/fallback shaping that turns live editor state into the snapshot
// that update-buffer-state persists and the restore path reads back.
// ---------------------------------------------------------------------------
interface RestoreWarning {
  tabId?: string | null
  pathname?: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
}

/**
 * Trim the final newlines according `trimTrailingNewlineOption`.
 *
 * @param markdown The text to trim.
 * @param trimTrailingNewlineOption The option how we should trim the final newlines.
 */
export const adjustTrailingNewlines = (
  markdown: string,
  trimTrailingNewlineOption: number
): string => {
  if (!markdown) {
    return ''
  }

  switch (trimTrailingNewlineOption) {
    // Trim trailing newlines.
    case 0: {
      return trimTrailingNewlines(markdown)
    }
    // Ensure single trailing newline.
    case 1: {
      // Muya will always add a final new line to the markdown text. Check first whether
      // only one newline exist to prevent copying the string.
      const lastIndex = markdown.length - 1
      if (markdown[lastIndex] === '\n') {
        if (markdown.length === 1) {
          // Just return nothing because adding a final new line makes no sense.
          return ''
        } else if (markdown[lastIndex - 1] !== '\n') {
          return markdown
        }
      }

      // Otherwise trim trailing newlines and add one.
      markdown = trimTrailingNewlines(markdown)
      if (markdown.length === 0) {
        // Just return nothing because adding a final new line makes no sense.
        return ''
      }
      return markdown + '\n'
    }
    // Disabled, use text as it is.
    default:
      return markdown
  }
}

/**
 * Trim trailing newlines from `text`.
 *
 * @param {string} text The text to trim.
 */
const trimTrailingNewlines = (text: string): string => {
  return text.replace(/[\r?\n]+$/, '')
}

/*
 * Convert a Pinia Proxy Object to a serializable value by applying JSON stringify and parse.
 */
function toSerializableValue<T>(value: T | null | undefined, fallback: T): T
function toSerializableValue<T>(value: T | null | undefined, fallback: null): T | null
function toSerializableValue<T>(value: T | null | undefined, fallback: T | null = null): T | null {
  if (value == null) return fallback

  try {
    return deepClone(value) as T
  } catch (err) {
    console.warn('Unable to serialize editor buffer value:', err)
    return fallback
  }
}

interface BufferedTabState {
  id: string
  pathname: string
  filename: string
  markdown: string
  isSaved: boolean
  encoding: IFileState['encoding']
  lineEnding: IFileState['lineEnding']
  trimTrailingNewline: number
  adjustLineEndingOnSave: boolean
  cursor: unknown
  wordCount: IFileState['wordCount']
  muyaIndexCursor: unknown
  scrollTop: number
}

const createBufferedTabState = (tab: Partial<IFileState> & { id: string }): BufferedTabState => {
  return {
    id: tab.id,
    pathname: tab.pathname ?? defaultFileState.pathname,
    filename: tab.filename ?? defaultFileState.filename,
    markdown: typeof tab.markdown === 'string' ? tab.markdown : defaultFileState.markdown,
    isSaved: tab.isSaved ?? defaultFileState.isSaved,
    encoding: toSerializableValue(tab.encoding, defaultFileState.encoding),
    lineEnding: tab.lineEnding ?? defaultFileState.lineEnding,
    trimTrailingNewline:
      typeof tab.trimTrailingNewline === 'number'
        ? tab.trimTrailingNewline
        : defaultFileState.trimTrailingNewline,
    adjustLineEndingOnSave: tab.adjustLineEndingOnSave ?? defaultFileState.adjustLineEndingOnSave,
    cursor: toSerializableValue(tab.cursor, defaultFileState.cursor),
    wordCount: toSerializableValue(tab.wordCount, defaultFileState.wordCount),
    muyaIndexCursor: toSerializableValue(tab.muyaIndexCursor, defaultFileState.muyaIndexCursor),
    scrollTop: tab.scrollTop ?? defaultFileState.scrollTop
  }
}

interface BufferedRestoreWarning {
  tabId: string | null
  pathname: string
  msg: string
  showConfirm: boolean
  style: string
  exclusiveType: string
}

const createBufferedRestoreWarning = (
  warning: RestoreWarning | null | undefined
): BufferedRestoreWarning | null => {
  if (!warning) return null

  const { tabId, pathname, msg, showConfirm, style, exclusiveType } = warning
  if (!tabId && !pathname) return null
  if (!msg) return null

  return {
    tabId: tabId || null,
    pathname: pathname || '',
    msg,
    showConfirm: !!showConfirm,
    style: style || 'info',
    exclusiveType: exclusiveType || ''
  }
}

interface BufferedEditorState {
  currentFileId: string | null
  tabs: BufferedTabState[]
  restoreWarnings: BufferedRestoreWarning[]
}

export const createBufferedEditorState = (state: unknown): BufferedEditorState | null => {
  const s = state as
    | {
      tabs?: unknown
      currentFileId?: string
      currentFile?: { id?: string } | null
      restoreWarnings?: unknown
    }
    | null
    | undefined
  if (!s || !Array.isArray(s.tabs)) {
    return null
  }

  return {
    currentFileId: s.currentFileId || s.currentFile?.id || null,
    tabs: (s.tabs as Array<Partial<IFileState> & { id: string }>).map(createBufferedTabState),
    restoreWarnings: Array.isArray(s.restoreWarnings)
      ? (s.restoreWarnings as RestoreWarning[])
        .map(createBufferedRestoreWarning)
        .filter((w): w is BufferedRestoreWarning => w !== null)
      : []
  }
}

/**
 * Return the opened root folder or an empty string.
 *
 * @param projectStore The project store instance.
 */
export const getRootFolderFromState = (projectStore: ProjectStoreLike): string => {
  const openedFolder = projectStore.projectTree
  if (openedFolder) {
    return openedFolder.pathname ?? ''
  }
  return ''
}
