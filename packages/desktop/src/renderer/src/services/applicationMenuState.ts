// The selection state the native application menu is derived from. Pure: it
// takes the payload the engine posts and returns the flags the menu templates
// read, which is why the store action, `menu/menus.ts` and the E2E parity spec
// can all work off the same shape.

interface AffiliationEntry {
  type: string
  functionType?: string
  listType?: string
  listItemType?: string
  isLooseListItem?: boolean
  [key: string]: unknown
}

export interface SelectionChange {
  start: {
    key: string
    offset: number
    block?: { text?: string; functionType?: string }
    type?: string
  }
  end: { key: string; offset: number; block?: { functionType?: string }; type?: string }
  affiliation?: AffiliationEntry[]
  hasFrontMatter?: boolean
}

export interface SelectionFormat {
  type: string
  [key: string]: unknown
}

export interface ApplicationMenuState {
  isDisabled: boolean
  isMultiline: boolean
  isLooseListItem: boolean
  isTaskList: boolean
  isCodeFences: boolean
  isCodeContent: boolean
  isTable: boolean
  hasFrontMatter: boolean
  affiliation: Record<string, boolean>
}

/**
 * Creates a object that contains the application menu state.
 *
 * @param {*} selection The selection.
 * @returns A object that represents the application menu state.
 */
export const createApplicationMenuState = ({
  start,
  end,
  affiliation,
  hasFrontMatter
}: SelectionChange): ApplicationMenuState => {
  const state: ApplicationMenuState = {
    isDisabled: false,
    // Whether multiple lines are selected.
    isMultiline: start.key !== end.key,
    // List information - a list must be selected.
    isLooseListItem: false,
    isTaskList: false,
    // Whether the selection is code block like (math, html or code block).
    isCodeFences: false,
    // Whether a code block line is selected.
    isCodeContent: false,
    // Whether the selection contains a table.
    isTable: false,
    hasFrontMatter: !!hasFrontMatter,
    // Contains keys about the selection type(s) (string, boolean) like "ul: true".
    affiliation: {}
  }
  const { isMultiline } = state
  const aff: AffiliationEntry[] = affiliation ?? []
  const startBlock: { text?: string; functionType?: string } = start.block ?? {}
  const endBlock: { functionType?: string } = end.block ?? {}

  // Get code block information from selection.
  if (
    (startBlock.functionType === 'cellContent' && endBlock.functionType === 'cellContent') ||
    (start.type === 'span' && startBlock.functionType === 'codeContent') ||
    (end.type === 'span' && endBlock.functionType === 'codeContent')
  ) {
    // A code block like block is selected (code, math, ...).
    state.isCodeFences = true

    // A code block line is selected.
    if (startBlock.functionType === 'codeContent' || endBlock.functionType === 'codeContent') {
      state.isCodeContent = true
    }
  }

  // Check every list level in the affiliation chain — nested lists show all
  // levels (e.g. a ul wrapping an ol checks both). Scanning the full chain (not
  // just the depth-3 loop below) keeps a deeply nested inner list checked. The
  // loose/task flags come from the INNERMOST list (the one the cursor is in);
  // the chain is outermost-first, so that is the last ul/ol entry.
  const listEntries = aff.filter((b) => b.type === 'ul' || b.type === 'ol')
  for (const entry of listEntries) {
    // Task and bullet lists are both `type: 'ul'`; distinguish by listType so a
    // chain with several kinds (e.g. ol > task > ul) checks each list menu item.
    const kind = entry.type === 'ol' ? 'ol' : entry.listType === 'task' ? 'task' : 'ul'
    state.affiliation[kind] = true
  }
  const innerList = listEntries[listEntries.length - 1]
  if (innerList) {
    // The engine's affiliation entry carries the loose flag on the list block
    // itself (derived from `meta.loose`), not via a `children` chain.
    state.isLooseListItem = !!innerList.isLooseListItem
    state.isTaskList = innerList.listType === 'task'
  }

  // Search with block depth 3 (e.g. "ul -> li -> p" where p is the actually paragraph inside the list (item)).
  for (const b of aff.slice(0, 3)) {
    if (b.type === 'pre' && b.functionType) {
      if (/frontmatter|html|multiplemath|code$/.test(b.functionType)) {
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (b.type === 'figure' && b.functionType) {
      if (b.functionType === 'table') {
        state.isTable = true
        state.isDisabled = true
        state.affiliation[b.type] = true
      } else if (b.functionType === 'diagram') {
        // Diagrams are atomic, non-formattable blocks: disable the whole
        // paragraph + format menus like a code fence, but they are not tables.
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (isMultiline && /^h{1,6}$/.test(b.type)) {
      // Multiple block elements are selected.
      state.affiliation = {}
      break
    } else if (b.type !== 'ul' && b.type !== 'ol') {
      // Lists are handled above (innermost only); the depth-limited scan must
      // not re-add an outer list type and check two list kinds at once.
      if (!state.affiliation[b.type]) {
        state.affiliation[b.type] = true
      }
    }
  }

  if (Object.getOwnPropertyNames(state.affiliation).length >= 2 && state.affiliation.p) {
    delete state.affiliation.p
  }
  if ((state.affiliation.ul || state.affiliation.ol) && state.affiliation.li) {
    delete state.affiliation.li
  }
  return state
}

/**
 * Creates a object that contains the formats selection state.
 */
export const createSelectionFormatState = (formats: SelectionFormat[]): Record<string, boolean> => {
  const state: Record<string, boolean> = {}
  for (const item of formats) {
    // Underline/superscript/subscript/highlight are carried as `html_tag`
    // tokens whose `tag` (u/sup/sub/mark) is the real format key the menu
    // map keys off — the bare `type` would only ever yield `html_tag`.
    const key = item.type === 'html_tag' ? (item.tag as string) : item.type
    if (key) state[key] = true
  }
  return state
}
