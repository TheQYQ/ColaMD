import { type BrowserWindow, type Menu, type MenuItem } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import type { SelectionState } from '@shared/types/ipc'
import { typedSend } from '../../ipc/typedSend'

// The selection-state shape lives in the shared contract now, so the channel
// that carries it can be checked by `typedOn`; re-exported for the importers
// that have always taken it from this module.
export type { SelectionState }

type Win = BrowserWindow | null | undefined

// Paragraph-menu items that can actually be executed across a multi-block
// selection; everything else is disabled when the selection spans blocks.
const CROSS_BLOCK_ENABLED_PARAGRAPH: readonly string[] = [
  'codeFencesMenuItem',
  'quoteBlockMenuItem',
  'orderListMenuItem',
  'bulletListMenuItem',
  'taskListMenuItem'
]

const MENU_ID_MAP: Readonly<Record<string, string>> = Object.freeze({
  heading1MenuItem: 'h1',
  heading2MenuItem: 'h2',
  heading3MenuItem: 'h3',
  heading4MenuItem: 'h4',
  heading5MenuItem: 'h5',
  heading6MenuItem: 'h6',
  tableMenuItem: 'figure',
  codeFencesMenuItem: 'pre',
  htmlBlockMenuItem: 'html',
  mathBlockMenuItem: 'multiplemath',
  quoteBlockMenuItem: 'blockquote',
  orderListMenuItem: 'ol',
  bulletListMenuItem: 'ul',
  taskListMenuItem: 'task',
  paragraphMenuItem: 'p',
  horizontalLineMenuItem: 'hr',
  frontMatterMenuItem: 'frontmatter' // 'pre'
})

const transformEditorElement = (win: Win, type: string): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::editor-paragraph-action', { type })
  }
}

export const bulletList = (win: Win): void => {
  transformEditorElement(win, 'ul-bullet')
}

export const codeFence = (win: Win): void => {
  transformEditorElement(win, 'pre')
}

export const degradeHeading = (win: Win): void => {
  transformEditorElement(win, 'degrade heading')
}

export const frontMatter = (win: Win): void => {
  transformEditorElement(win, 'front-matter')
}

export const heading1 = (win: Win): void => {
  transformEditorElement(win, 'heading 1')
}

export const heading2 = (win: Win): void => {
  transformEditorElement(win, 'heading 2')
}

export const heading3 = (win: Win): void => {
  transformEditorElement(win, 'heading 3')
}

export const heading4 = (win: Win): void => {
  transformEditorElement(win, 'heading 4')
}

export const heading5 = (win: Win): void => {
  transformEditorElement(win, 'heading 5')
}

export const heading6 = (win: Win): void => {
  transformEditorElement(win, 'heading 6')
}

export const horizontalLine = (win: Win): void => {
  transformEditorElement(win, 'hr')
}

export const htmlBlock = (win: Win): void => {
  transformEditorElement(win, 'html')
}

export const looseListItem = (win: Win): void => {
  transformEditorElement(win, 'loose-list-item')
}

export const mathFormula = (win: Win): void => {
  transformEditorElement(win, 'mathblock')
}

export const orderedList = (win: Win): void => {
  transformEditorElement(win, 'ol-order')
}

export const paragraph = (win: Win): void => {
  transformEditorElement(win, 'paragraph')
}

export const quoteBlock = (win: Win): void => {
  transformEditorElement(win, 'blockquote')
}

export const table = (win: Win): void => {
  transformEditorElement(win, 'table')
}

export const taskList = (win: Win): void => {
  transformEditorElement(win, 'ul-task')
}

export const increaseHeading = (win: Win): void => {
  transformEditorElement(win, 'upgrade heading')
}

// --- Commands -------------------------------------------------------------

export const loadParagraphCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.PARAGRAPH_BULLET_LIST, bulletList)
  commandManager.add(COMMANDS.PARAGRAPH_CODE_FENCE, codeFence)
  commandManager.add(COMMANDS.PARAGRAPH_DEGRADE_HEADING, degradeHeading)
  commandManager.add(COMMANDS.PARAGRAPH_FRONT_MATTER, frontMatter)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_1, heading1)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_2, heading2)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_3, heading3)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_4, heading4)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_5, heading5)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_6, heading6)
  commandManager.add(COMMANDS.PARAGRAPH_HORIZONTAL_LINE, horizontalLine)
  commandManager.add(COMMANDS.PARAGRAPH_HTML_BLOCK, htmlBlock)
  commandManager.add(COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM, looseListItem)
  commandManager.add(COMMANDS.PARAGRAPH_MATH_FORMULA, mathFormula)
  commandManager.add(COMMANDS.PARAGRAPH_ORDERED_LIST, orderedList)
  commandManager.add(COMMANDS.PARAGRAPH_PARAGRAPH, paragraph)
  commandManager.add(COMMANDS.PARAGRAPH_QUOTE_BLOCK, quoteBlock)
  commandManager.add(COMMANDS.PARAGRAPH_TABLE, table)
  commandManager.add(COMMANDS.PARAGRAPH_TASK_LIST, taskList)
  commandManager.add(COMMANDS.PARAGRAPH_INCREASE_HEADING, increaseHeading)
}

// --- IPC events -------------------------------------------------------------

// NOTE: Don't use static `getMenuItemById` here, instead request the menu by
//       window id from `AppMenu` manager.

// PERF-03 (#GUI-B3): `selection-change` arrives per caret tick. Each raw
// `item.enabled = x` / `item.checked = x` assignment pushes a native-menu sync
// on Windows even when the value did not change, so the menu rewrites below go
// through these guards and only touch items that actually move.
const setItemEnabled = (item: MenuItem, enabled: boolean): void => {
  if (item.enabled !== enabled) item.enabled = enabled
}

export const setItemChecked = (item: MenuItem, checked: boolean): void => {
  if (item.checked !== checked) item.checked = checked
}

const setCheckedMenuItem = (
  applicationMenu: Menu,
  { affiliation, isTable, isLooseListItem }: SelectionState
): void => {
  const paragraphMenuItem = applicationMenu.getMenuItemById('paragraphMenuEntry')!
  // Each item is set straight to its desired value (instead of reset-all then
  // re-check) so a repeated state performs zero native-menu writes (PERF-03).
  paragraphMenuItem.submenu!.items.forEach((item: MenuItem) => {
    if (!item.id) {
      return
    }
    if (item.id === 'looseListItemMenuItem') {
      setItemChecked(item, !!isLooseListItem)
      return
    }
    setItemChecked(item, isCheckedForState(item, affiliation, isTable))
  })
}

// Does this paragraph item's affiliation key match the current selection?
// Each list kind is its own affiliation key (ol / ul / task), so a nested
// chain checks every level via the id map.
const isCheckedForState = (
  item: MenuItem,
  affiliation: SelectionState['affiliation'],
  isTable: boolean | undefined
): boolean =>
  Object.keys(affiliation).some((b) => {
    if (isTable && item.id === 'tableMenuItem') {
      return true
    }
    if (item.id === 'codeFencesMenuItem' && /code$/.test(b)) {
      return true
    }
    return b === MENU_ID_MAP[item.id]
  })

/**
 * Update paragraph menu entires from given state.
 *
 * PERF-03 (#GUI-B3): every item's final enabled/checked value is derived
 * FIRST and written once through the guarded setters — the old shape
 * (blanket enable, then selective disables) flipped the same item twice and
 * pushed redundant native-menu syncs on every caret tick.
 *
 * @param applicationMenu The application menu instance.
 * @param state The selection information.
 */
export const updateSelectionMenus = (applicationMenu: Menu, state: SelectionState): void => {
  const {
    // Key/boolean object like "ul: true" of block elements that are selected.
    // This may be an empty object when multiple block elements are selected.
    affiliation,
    isDisabled,
    isMultiline,
    isCodeFences,
    isCodeContent
  } = state

  const inList = !!(affiliation.ul || affiliation.ol || affiliation.task)
  const hasCodeLine: boolean =
    !!isCodeContent && Object.keys(affiliation).some((b) => /code$/.test(b))

  // Final desired enabled value per Paragraph item. Branch order mirrors the
  // original cascade: disabled → code-fences (with the code-line re-enable) →
  // multi-block (only cross-block actions) → normal (loose list item and
  // front matter carry their own conditions).
  const paragraphEnabled = (id: string): boolean => {
    if (isDisabled) return false
    if (isCodeFences) return id === 'codeFencesMenuItem' && hasCodeLine
    if (isMultiline) return CROSS_BLOCK_ENABLED_PARAGRAPH.includes(id)
    if (id === 'looseListItemMenuItem') return inList
    // Front matter may exist at most once per document; disable the menu item
    // whenever the document already has one.
    if (id === 'frontMatterMenuItem') return !state.hasFrontMatter
    return true
  }

  // Final desired enabled value per Format item. When the selection is
  // disabled (e.g. a table) formatting stays available — that is why the
  // original early-return left the format menu enabled. Non-formattable
  // code-like content (code/math/html/frontmatter/diagram) disables every
  // format item; link/image are meaningless across a multi-block selection.
  const formatEnabled = (id: string): boolean => {
    if (isDisabled) return true
    if (isCodeFences) return false
    if (isMultiline) return id !== 'hyperlinkMenuItem' && id !== 'imageMenuItem'
    return true
  }

  const paragraphMenuItem = applicationMenu.getMenuItemById('paragraphMenuEntry')!
  paragraphMenuItem.submenu!.items.forEach((item: MenuItem) => {
    setItemEnabled(item, paragraphEnabled(item.id ?? ''))
  })
  setCheckedMenuItem(applicationMenu, state)

  const formatMenuItem: MenuItem = applicationMenu.getMenuItemById('formatMenuItem')!
  formatMenuItem.submenu!.items.forEach((item: MenuItem) => {
    setItemEnabled(item, formatEnabled(item.id ?? ''))
  })
}
