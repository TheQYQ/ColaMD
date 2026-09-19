// User preferences shape. The canonical schema lives in
// src/main/preferences/schema.json + src/main/preferences/index.ts — this
// interface is the renderer-facing mirror that lets the preferences store
// (Commit 7) and the preferences pane (Commit 8) consume typed values.
//
// Kept intentionally open with `[key: string]: unknown` until the schema
// is mechanically derived from schema.json in a follow-up.

/** Startup behaviour; must stay in step with schema.json's startUpAction enum. */
export type StartUpAction = 'blank' | 'restoreAll' | 'folder' | 'openLastFolder'

/** Runtime view of `StartUpAction`, so the schema and the enum can be compared. */
export const START_UP_ACTIONS: readonly StartUpAction[] = [
  'blank',
  'restoreAll',
  'folder',
  'openLastFolder'
]

export interface IUserPreferences {
  autoSave?: boolean
  autoSaveDelay?: number
  titleBarStyle?: 'custom' | 'native'
  openFilesInNewWindow?: boolean
  openFolderInNewWindow?: boolean
  hideScrollbar?: boolean
  sidebarColumn?: number
  fileSortBy?: string
  fileSortOrder?: string
  startUpAction?: StartUpAction
  defaultDirectoryToOpen?: string
  language?: string
  editorFontFamily?: string
  fontSize?: number
  lineHeight?: number
  codeFontSize?: number
  codeFontFamily?: string
  hideQuickInsertHint?: boolean
  hideLinkPopup?: boolean
  autoPairBracket?: boolean
  autoPairMarkdownSyntax?: boolean
  autoPairQuote?: boolean
  endOfLine?: 'default' | 'lf' | 'crlf'
  defaultEncoding?: string
  autoGuessEncoding?: boolean
  trimTrailingNewline?: number
  textDirection?: 'ltr' | 'rtl' | 'auto'
  preferLooseListItem?: boolean
  bulletListMarker?: '-' | '*' | '+'
  orderListDelimiter?: '.' | ')'
  preferHeadingStyle?: 'atx' | 'setext'
  tabSize?: number
  listIndentation?: number | string
  frontmatterType?: '-' | ';' | '+' | '{'
  superSubScript?: boolean
  footnote?: boolean
  mathLatexDelimiters?: boolean
  inlineComment?: boolean
  definitionList?: boolean
  isHtmlEnabled?: boolean
  isGitlabCompatibilityEnabled?: boolean
  theme?: string
  spellcheckerEnabled?: boolean
  spellcheckerNoUnderline?: boolean
  spellcheckerLanguage?: string
  imageInsertAction?: 'upload' | 'folder' | 'path'
  imagePreferRelativePath?: boolean
  // `imageFolderPath` is deliberately absent: the folder is stored by DataCenter,
  // whose dialog is the only writer, because it also grants write scope.
  deleteUnreferencedImages?: boolean
  screenshotFolderPath?: string
  imageBed?: { selected?: string; [key: string]: unknown }
  imageBedAlias?: { [key: string]: unknown }
  watcher?: { usePolling?: boolean; [key: string]: unknown }
  searchExclusions?: string[]
  searchMaxFileSize?: string
  searchIncludeHidden?: boolean
  searchNoIgnore?: boolean
  searchFollowSymlinks?: boolean
  followSystemTheme?: boolean
  lightModeTheme?: string
  darkModeTheme?: string
  lastOpenedFolder?: string
  autoNormalizeLineEndings?: boolean
  watcherUsePolling?: boolean
  treePathExcludePatterns?: string[]
  treeShowNonMarkdownFiles?: boolean
  treeShowHiddenFiles?: boolean
  [key: string]: unknown
}

export interface LayoutState {
  rightColumn: 'files' | 'search' | 'toc'
  showSideBar: boolean
  showTabBar: boolean
  [key: string]: unknown
}
