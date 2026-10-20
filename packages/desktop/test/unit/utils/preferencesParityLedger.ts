// Preferences contract-parity ledger: the known drift between the copies of
// the preference contract. The parity spec (preferences-contract-parity.spec.ts)
// recomputes each set from source and requires an exact match, so drift may
// only shrink. Pattern follows pathScopeInventory.
//
// Five copies of the contract exist:
//   1. src/main/preferences/schema.json   — runtime authority (ajv validation)
//   2. static/preference.json             — shipped defaults; pinned to the
//      schema by preference-schema-parity.spec.ts (O19)
//   3. src/shared/types/preferences.ts    — renderer-facing TS mirror
//      (IUserPreferences unions + START_UP_ACTIONS const)
//   4. src/renderer/src/prefComponents/** — UI option lists (config.ts arrays,
//      radio groups, computed option lists in .vue files)
//   5. src/renderer/src/store/preferences.ts — renderer store pre-load defaults
//
// startUpAction is additionally pinned by startup-action.spec.ts; the generic
// checks here cover it too, which is intended (a new value must update every
// copy, and each spec is one more place that notices).

/** Enum keys whose TS mirror lost its literal union (widened to
 *  `string`/`number` or absent from the interface). Fix = restore the literal
 *  union (plus the const array where one exists), then delete the entry. */
export const enumWidenedInTs: Record<string, string> = {
  fileSortBy: 'widened to `string`; schema and UI agree on created/modified/title',
  fileSortOrder: 'widened to `string`; schema and UI agree on asc/desc',
  defaultEncoding:
    'widened to `string`; UI mirrors ENCODING_NAME_MAP, identical to the schema enum',
  trimTrailingNewline: 'widened to `number`; schema and UI agree on 0/1/2/3',
  listIndentation: 'widened to `number | string`; schema and UI agree on dfm/tab/1-4',
  sequenceTheme: 'absent from the interface; reached through the open index signature',
  imageRelativeDirectoryBase: 'absent from the interface; reached through the open index signature'
}

/** Keys declared in `IUserPreferences` but absent from schema.json, so the
 *  runtime never validates them. Fix = add the schema entry (or delete the
 *  stale declaration), then delete the entry here. */
export const tsOnlyKeys: Record<string, string> = {
  sidebarColumn: 'renderer layout value; never persisted through the schema',
  imagePreferRelativePath:
    'stale name — schema and store both use imagePreferRelativeDirectory; no readers, delete the declaration',
  deleteUnreferencedImages: 'user config written by the image pane; schema entry missing',
  screenshotFolderPath: 'user config; schema entry missing',
  imageBed: 'uploader config object; schema entry missing',
  imageBedAlias: 'uploader config object; schema entry missing',
  watcher: 'legacy nested watcher object; superseded by the flat watcherUsePolling key'
}

/** Keys in schema.json with no property in `IUserPreferences`. Informational:
 *  the runtime validates them and the renderer reaches them through the open
 *  index signature. Fix = add the typed property, then delete the entry. */
export const schemaOnlyKeys: string[] = [
  'autoCheck',
  'codeBlockLineNumbers',
  'customCss',
  'editorLineWidth',
  'imagePreferRelativeDirectory',
  'imageRelativeDirectoryBase',
  'imageRelativeDirectoryName',
  'openedFilesInSidebar',
  'plantumlServer',
  'restoreLayoutState',
  'sequenceTheme',
  'sideBarVisibility',
  'sourceCodeModeEnabled',
  'tabBarVisibility',
  'trimUnnecessaryCodeBlockEmptyLines',
  'wrapCodeBlocks',
  'wordWrapInToc',
  'zoom'
]

/** Store pre-load defaults that differ from the schema default. Fix = align
 *  the store (main broadcasts the stored value on startup, so these are
 *  pre-load cosmetics — but they still mislead), then delete the entry. */
export const defaultMismatches: Record<string, { store: string; schema: string; reason: string }> =
  {
    lineHeight: {
      store: '1.7',
      schema: '1.6',
      reason: 'store ships a roomier pre-load default than the schema/static file'
    },
    imageInsertAction: {
      store: 'folder',
      schema: 'path',
      reason: 'store pre-load default differs from the schema/static file'
    }
  }

/** Where each schema enum key gets its UI option values. A new enum key must
 *  register here (or in `enumKeysWithoutUi`) or the spec fails. */
interface UiOptionSource {
  /** Path relative to the package root. */
  file: string
  /** Extract `value: …` pairs from the block declaring this symbol. */
  symbol?: string
  /** Extract radio `label="…"` values from the el-radio-group bound to this v-model. */
  radioModel?: string
  /** Values are the keys of ENCODING_NAME_MAP (common/encoding). */
  encodingMap?: boolean
}

export const uiOptionSources: Record<string, UiOptionSource> = {
  titleBarStyle: {
    file: 'src/renderer/src/prefComponents/general/config.ts',
    symbol: 'getTitleBarStyleOptions'
  },
  fileSortBy: {
    file: 'src/renderer/src/prefComponents/general/config.ts',
    symbol: 'getFileSortByOptions'
  },
  fileSortOrder: {
    file: 'src/renderer/src/prefComponents/general/config.ts',
    symbol: 'getFileSortOrderOptions'
  },
  startUpAction: {
    file: 'src/renderer/src/prefComponents/general/index.vue',
    radioModel: 'startUpAction'
  },
  endOfLine: {
    file: 'src/renderer/src/prefComponents/editor/config.ts',
    symbol: 'getEndOfLineOptions'
  },
  trimTrailingNewline: {
    file: 'src/renderer/src/prefComponents/editor/config.ts',
    symbol: 'getTrimTrailingNewlineOptions'
  },
  textDirection: {
    file: 'src/renderer/src/prefComponents/editor/config.ts',
    symbol: 'getTextDirectionOptions'
  },
  defaultEncoding: { file: 'src/common/encoding.ts', encodingMap: true },
  bulletListMarker: {
    file: 'src/renderer/src/prefComponents/markdown/config.ts',
    symbol: 'bulletListMarkerOptions'
  },
  orderListDelimiter: {
    file: 'src/renderer/src/prefComponents/markdown/config.ts',
    symbol: 'orderListDelimiterOptions'
  },
  listIndentation: {
    file: 'src/renderer/src/prefComponents/markdown/config.ts',
    symbol: 'getListIndentationOptions'
  },
  frontmatterType: {
    file: 'src/renderer/src/prefComponents/markdown/config.ts',
    symbol: 'getFrontmatterTypeOptions'
  },
  sequenceTheme: {
    file: 'src/renderer/src/prefComponents/markdown/config.ts',
    symbol: 'getSequenceThemeOptions'
  },
  imageInsertAction: {
    file: 'src/renderer/src/prefComponents/image/config.ts',
    symbol: 'getImageActions'
  },
  imageRelativeDirectoryBase: {
    file: 'src/renderer/src/prefComponents/image/components/folderSetting/index.vue',
    symbol: 'imageRelativeDirectoryBaseOptions'
  }
}

/** Enum keys with no UI by design (reason required). */
export const enumKeysWithoutUi: Record<string, string> = {}
