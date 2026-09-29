import bus from '../bus'
import { delay } from '@/util'
import { FileSearcher } from '@/node/ripgrepSearcher'
import type { EditorState } from '@/store/editor'
import getCommandDescriptionById from './descriptions'
import { t } from '../i18n'

const SPECIAL_CHARS = /[\[\]\\^$.\|\?\*\+\(\)\/]{1}/g // eslint-disable-line no-useless-escape

// `*` maps to `.*`, so a run of n stars becomes n nested `.*` groups that
// backtrack against every non-matching tail: measured 23 s of a blocked
// renderer main thread for six stars against one 69-character path. `.*.*`
// accepts the same language as `.*`, so collapsing the run keeps results
// identical. The only `*` the escaped source can contain is one produced by a
// star, so a match always starts at a real star token -- a query's literal `.`
// arrives as `\.` and never joins a run.
const NESTED_STARS = /(?:\.\*)+/g

/** Compiles a quick-open glob into a matcher, or returns null if the query is
 *  not a valid pattern. `{` and `}` are not escaped, so a query like
 *  `a{2,}{2,}` reaches the engine as a malformed quantifier ("Nothing to
 *  repeat"); the caller then matches the query as literal text. */
const compilePattern = (query: string): RegExp | null => {
  const source = query
    .replace(SPECIAL_CHARS, (p) => {
      if (p === '*') return '.*'
      return p === '\\' ? '\\\\' : `\\${p}`
    })
    .replace(NESTED_STARS, '.*')

  try {
    return new RegExp(source, 'i')
  } catch {
    return null
  }
}

interface QuickOpenSubcommand {
  id: string
  description?: string
  title?: string
}

interface FolderState {
  projectTree: { pathname: string } | null
}
type RootState = { editor: EditorState; project: FolderState; [key: string]: unknown }

type CancelFn = (() => void) | null

// The quick open command
class QuickOpenCommand {
  id: string
  description: string
  placeholder: string
  shortcut: string | null
  subcommands: QuickOpenSubcommand[]
  subcommandSelectedIndex: number
  private _editorState: EditorState
  private _folderState: FolderState
  private _directorySearcher: FileSearcher
  private _cancelFn: CancelFn

  constructor(rootState: RootState) {
    this.id = 'file.quick-open'
    this.description = getCommandDescriptionById('file.quick-open')
    this.placeholder = t('commandPalette.placeholders.searchFileToOpen')
    this.shortcut = null

    this.subcommands = []
    this.subcommandSelectedIndex = -1

    // Reference to folder and editor and project state.
    this._editorState = rootState.editor
    this._folderState = rootState.project

    this._directorySearcher = new FileSearcher()
    this._cancelFn = null
  }

  search = async (query: string): Promise<QuickOpenSubcommand[]> => {
    // Cancel what the previous keystroke started before answering anything. The
    // empty-query branch below never touches the searcher, so backspacing to
    // clear the box used to leave a running `rg --files` alive -- and since a
    // cancelled searcher resolves instead of rejecting, that scan's results were
    // still handed back to the palette afterwards. #28 item 4.
    const { _cancelFn } = this
    if (_cancelFn) {
      _cancelFn()
      this._cancelFn = null
    }

    // Show opened files when no query given.
    if (!query) {
      return this.subcommands
    }

    const timeout = delay(300)
    this._cancelFn = () => {
      timeout.cancel()
      this._cancelFn = null
    }

    await timeout
    return this._doSearch(query)
  }

  run = async (): Promise<void> => {
    const { _editorState, _folderState } = this
    if (!_folderState.projectTree && _editorState.tabs.length === 0) {
      throw new Error(null as unknown as string)
    }

    this.subcommands = _editorState.tabs
      .map((tab) => tab.pathname)
      // Filter untitled tabs
      .filter((tabPath: string | null | undefined) => !!tabPath)
      .map((pathname: string) => {
        const item: QuickOpenSubcommand = { id: pathname }
        Object.assign(item, this._getPath(pathname))
        return item
      })
  }

  execute = async (): Promise<void> => {
    // Timeout to hide the command palette and then show again to prevent issues.
    await delay(100)
    bus.emit('show-command-palette', this)
  }

  executeSubcommand = async (id: string): Promise<void> => {
    const { windowId } = window.colamd!.env!
    window.electron.ipcRenderer.send('mt::open-file-by-window-id', windowId, id)
  }

  unload = (): void => {
    this.subcommands = []
  }

  // --- private ------------------------------------------

  _doSearch = (query: string): QuickOpenSubcommand[] | Promise<QuickOpenSubcommand[]> => {
    this._cancelFn = null
    const { _editorState, _folderState } = this
    const isRootDirOpened = !!_folderState.projectTree
    const tabsAvailable = _editorState.tabs.length > 0

    // Only show opened files if no directory is opened.
    if (!isRootDirOpened && !tabsAvailable) {
      return []
    }

    const searchResult: string[] = []
    const rootPath: string | null = isRootDirOpened ? _folderState.projectTree!.pathname : null

    // Add files that are not in the current root directory but opened.
    if (tabsAvailable) {
      const re = compilePattern(query)
      const lowerQuery = query.toLowerCase()
      const matches = (pathname: string): boolean =>
        re ? re.test(pathname) : pathname.toLowerCase().includes(lowerQuery)

      for (const tab of _editorState.tabs) {
        const { pathname } = tab
        if (
          pathname &&
          matches(pathname) &&
          (!rootPath || !window.fileUtils.isChildOfDirectory(rootPath, pathname))
        ) {
          searchResult.push(pathname)
        }
      }
    }

    if (!isRootDirOpened) {
      return searchResult.map((pathname) => {
        return {
          id: pathname,
          description: pathname,
          title: pathname
        }
      })
    }

    // Search root directory on disk.
    return new Promise<QuickOpenSubcommand[]>((resolve, reject) => {
      let canceled = false
      // `cancel` lives on the promise the searcher returns. Chaining `.then` and
      // `.catch` onto it, as this used to do, produces plain promises that lost
      // the method, so both abort paths below silently did nothing: the scan ran
      // to the end of the tree on every keystroke, and cancelling a superseded
      // search cancelled nothing.
      const search = this._directorySearcher.search([rootPath!], '', {
        didMatch: (result: unknown) => {
          if (canceled) return
          searchResult.push(result as string)
        },
        didSearchPaths: (numPathsFound: unknown) => {
          // Cancel when more than 30 files were found. User should specify the search query.
          if (!canceled && (numPathsFound as number) > 30) {
            canceled = true
            search.cancel()
          }
        },

        // Only search markdown files that contain the query string.
        inclusions: this._getInclusions(query)
      })

      search
        .then(() => {
          this._cancelFn = null
          resolve(
            searchResult.map((pathname) => {
              const item: QuickOpenSubcommand = { id: pathname }
              Object.assign(item, this._getPath(pathname))
              return item
            })
          )
        })
        .catch((error: unknown) => {
          this._cancelFn = null
          reject(error)
        })

      this._cancelFn = () => {
        this._cancelFn = null
        canceled = true
        search.cancel()
      }
    })
  }

  _getInclusions = (query: string): string[] => {
    // NOTE: This will fail on `foo.m` because we search for `foo.m.md`.
    if (window.fileUtils.hasMarkdownExtension(query)) {
      return [`*${query}`]
    }

    const inclusions: string[] = []
    for (let i = 0; i < window.fileUtils.MARKDOWN_INCLUSIONS.length; ++i) {
      inclusions[i] = `*${query}` + window.fileUtils.MARKDOWN_INCLUSIONS[i]
    }
    return inclusions
  }

  _getPath = (pathname: string): { title?: string; description: string } => {
    const rootPath: string = this._folderState.projectTree!.pathname
    if (!window.fileUtils.isChildOfDirectory(rootPath, pathname)) {
      return { title: pathname, description: pathname }
    }

    const p = window.path.relative(rootPath, pathname)
    const item: { title?: string; description: string } = { description: p }
    if (p.length > 50) {
      item.title = p
    }
    return item
  }
}

export default QuickOpenCommand
