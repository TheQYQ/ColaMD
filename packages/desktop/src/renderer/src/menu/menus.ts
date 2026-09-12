import bus from '../bus'
import { t } from '../i18n'
import { PATH_SEPARATOR } from '../config'
import { usePreferencesStore } from '../store/preferences'
import { useLayoutStore } from '../store/layout'
import { useEditorStore, type ApplicationMenuState } from '../store/editor'
import { useCommandCenterStore } from '../store/commandCenter'
import type { MenuItemDef, MenuTopDef } from './types'

/**
 * Typora-style menu schema for the frameless HTML menu bar (Windows/Linux).
 *
 * The macOS app keeps its native menu bar (main/menu/templates); this module
 * mirrors the same structure for the drawn menu bar, wiring each item to the
 * same action chains: renderer command-center commands, bus events consumed by
 * editor.vue / stores, or direct IPC. Checked / enabled resolution mirrors
 * `main/menu/actions/paragraph.ts` (`updateSelectionMenus`) and
 * `main/menu/actions/format.ts` (`updateFormatMenu`).
 */

// --- helpers ---------------------------------------------------------------

const basename = (p: string): string => p.split(PATH_SEPARATOR).filter(Boolean).pop() || p

const sep = (): MenuItemDef => ({ type: 'separator' })

interface ItemOptions {
  checked?: boolean
  enabled?: boolean
  hint?: string
  children?: MenuItemDef[]
}

const item = (label: string, action: () => void, opts: ItemOptions = {}): MenuItemDef => ({
  type: 'item',
  label,
  action,
  enabled: opts.enabled,
  checked: opts.checked,
  hint: opts.hint,
  children: opts.children
})

const checkbox = (
  label: string,
  checked: boolean,
  action: () => void,
  opts: Omit<ItemOptions, 'checked' | 'children'> = {}
): MenuItemDef => ({
  type: 'checkbox',
  label,
  action,
  checked,
  enabled: opts.enabled,
  hint: opts.hint
})

// Menu-bar actions blur the editor; restore engine focus before applying
// paragraph/format/edit actions (same pattern as the renderer command center).
const focusThen = (fn: () => void): (() => void) => {
  return () => {
    setTimeout(() => bus.emit('editor-focus'), 10)
    setTimeout(fn, 150)
  }
}

// Shortcuts come from the command center (fed by `mt::keybindings-response`).
// Entries that exist only as main-process commands fall back to the Windows
// default accelerators.
const FALLBACK_HINTS: Record<string, string> = {
  'view.command-palette': 'Ctrl+Shift+P',
  'view.toggle-toc': 'Ctrl+K',
  'view.reload-images': 'F5',
  'edit.cut': 'Ctrl+X',
  'edit.copy': 'Ctrl+C',
  'edit.paste': 'Ctrl+V'
}

const hintFor = (commandCenter: ReturnType<typeof useCommandCenterStore>, commandId: string): string | undefined => {
  const entry = commandCenter.rootCommand.subcommands.find((c) => c.id === commandId)
  if (entry?.shortcut?.length) return entry.shortcut.join('+')
  return FALLBACK_HINTS[commandId]
}

const executeCommand = (commandId: string): (() => void) => () => bus.emit('cmd::execute', commandId)

// --- selection state resolution (mirrors updateSelectionMenus) --------------

// Paragraph-menu items that can execute across a multi-block selection.
const CROSS_BLOCK_ENABLED: readonly string[] = [
  'code-fences',
  'quote-block',
  'order-list',
  'bullet-list',
  'task-list'
]

const PARAGRAPH_BLOCK_MAP: Readonly<Record<string, string>> = Object.freeze({
  'heading-1': 'h1',
  'heading-2': 'h2',
  'heading-3': 'h3',
  'heading-4': 'h4',
  'heading-5': 'h5',
  'heading-6': 'h6',
  table: 'figure',
  'code-fences': 'pre',
  'html-block': 'html',
  'math-block': 'multiplemath',
  'quote-block': 'blockquote',
  'order-list': 'ol',
  'bullet-list': 'ul',
  'task-list': 'task',
  paragraph: 'p',
  'horizontal-line': 'hr',
  'front-matter': 'frontmatter'
})

// Selection state before the first muya `selection-change` (freshly restored
// tab, untouched document). Mirrors the native menu's initial state: nothing
// disabled, nothing checked.
const DEFAULT_SELECTION_STATE: ApplicationMenuState = {
  isDisabled: false,
  isMultiline: false,
  isLooseListItem: false,
  isTaskList: false,
  isCodeFences: false,
  isCodeContent: false,
  isTable: false,
  hasFrontMatter: false,
  affiliation: {}
}

interface ParagraphItemState {
  checked: boolean
  enabled: boolean
}

const resolveParagraphItem = (
  state: ApplicationMenuState | null,
  hasFile: boolean,
  itemId: string
): ParagraphItemState => {
  if (!hasFile || !state) return { checked: false, enabled: false }

  const affiliation = state.affiliation ?? {}
  let checked = false
  if (itemId === 'loose-list-item') {
    checked = !!state.isLooseListItem
  } else {
    checked = Object.keys(affiliation).some((block) => {
      if (state.isTable && itemId === 'table') return true
      if (itemId === 'code-fences' && /code$/.test(block)) return true
      return block === PARAGRAPH_BLOCK_MAP[itemId]
    })
  }

  let enabled = !state.isDisabled
  if (enabled && state.isCodeFences) {
    enabled =
      itemId === 'code-fences' &&
      !!state.isCodeContent &&
      Object.keys(affiliation).some((block) => /code$/.test(block))
  } else if (enabled && state.isMultiline) {
    enabled = CROSS_BLOCK_ENABLED.includes(itemId)
  }
  if (enabled && itemId === 'loose-list-item') {
    enabled = !!(affiliation.ul || affiliation.ol || affiliation.task)
  }
  if (enabled && itemId === 'front-matter') {
    enabled = !state.hasFrontMatter
  }
  return { checked, enabled }
}

const paragraphItem = (
  state: ApplicationMenuState | null,
  hasFile: boolean,
  itemId: string,
  label: string,
  actionType: string,
  hint?: string
): MenuItemDef => {
  const { checked, enabled } = resolveParagraphItem(state, hasFile, itemId)
  return {
    id: itemId,
    type: 'checkbox',
    label,
    checked,
    enabled,
    hint,
    action: focusThen(() => bus.emit('paragraph', actionType))
  }
}

// --- themes (keep in sync with main/menu/templates/theme.ts) ----------------

const LIGHT_THEMES: ReadonlyArray<readonly [string, string]> = [
  ['ayuLight', 'ayu-light'],
  ['cadmiumLight', 'light'],
  ['catppuccinLatte', 'catppuccin-latte'],
  ['everforestLight', 'everforest-light'],
  ['graphiteLight', 'graphite'],
  ['gruvboxLight', 'gruvbox-light'],
  ['rosePineDawn', 'rose-pine-dawn'],
  ['solarizedLight', 'solarized-light'],
  ['tokyoNightLight', 'tokyo-night-light'],
  ['ulyssesLight', 'ulysses']
]

const DARK_THEMES: ReadonlyArray<readonly [string, string]> = [
  ['ayuDark', 'ayu-dark'],
  ['ayuMirage', 'ayu-mirage'],
  ['cadmiumDark', 'dark'],
  ['catppuccinMocha', 'catppuccin-mocha'],
  ['cyberdream', 'cyberdream'],
  ['dracula', 'dracula'],
  ['everforestDark', 'everforest-dark'],
  ['gruvboxDark', 'gruvbox-dark'],
  ['horizonDark', 'horizon-dark'],
  ['kanagawa', 'kanagawa'],
  ['materialDark', 'material-dark'],
  ['monokaiPro', 'monokai-pro'],
  ['nightfox', 'nightfox'],
  ['nord', 'nord'],
  ['oneDark', 'one-dark'],
  ['oxocarbonDark', 'oxocarbon-dark'],
  ['palenight', 'palenight'],
  ['rosePine', 'rose-pine'],
  ['rosePineMoon', 'rose-pine-moon'],
  ['solarizedDark', 'solarized-dark'],
  ['synthwave84', 'synthwave-84'],
  ['tokyoNight', 'tokyo-night'],
  ['tokyoNightStorm', 'tokyo-night-storm']
]

// --- menu builders -----------------------------------------------------------

const buildFileMenu = (
  recentFiles: string[],
  hasFile: boolean
): MenuItemDef[] => {
  const preferencesStore = usePreferencesStore()

  const recentChildren: MenuItemDef[] = recentFiles.map((filePath) =>
    item(basename(filePath), () => {
      window.electron.ipcRenderer.send('mt::menu::open-path', filePath)
    })
  )
  if (recentFiles.length > 0) {
    recentChildren.push(
      sep(),
      item(t('menu.file.clearRecentlyUsed'), () => {
        window.electron.ipcRenderer.send('menu-clear-recently-used')
        recentFiles.splice(0, recentFiles.length)
      })
    )
  } else {
    recentChildren.push(item(t('menu.file.clearRecentlyUsed'), () => {}, { enabled: false }))
  }

  return [
    item(t('menu.file.newTab'), executeCommand('file.new-tab'), { hint: hintFor(useCommandCenterStore(), 'file.new-tab') }),
    item(t('menu.file.newWindow'), executeCommand('file.new-window'), { hint: hintFor(useCommandCenterStore(), 'file.new-window') }),
    sep(),
    item(t('menu.file.openFile'), executeCommand('file.open-file'), { hint: hintFor(useCommandCenterStore(), 'file.open-file') }),
    item(t('menu.file.openFolder'), executeCommand('file.open-folder'), { hint: hintFor(useCommandCenterStore(), 'file.open-folder') }),
    item(t('menu.file.openRecent'), () => {}, { children: recentChildren }),
    sep(),
    item(t('menu.file.save'), executeCommand('file.save'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.save') }),
    item(t('menu.file.saveAs'), executeCommand('file.save-as'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.save-as') }),
    checkbox(t('menu.file.autoSave'), !!preferencesStore.autoSave, () => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { autoSave: !preferencesStore.autoSave })
    }),
    sep(),
    item(t('menu.file.moveTo'), executeCommand('file.move-file'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.move-file') }),
    item(t('menu.file.rename'), executeCommand('file.rename-file'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.rename-file') }),
    sep(),
    item(t('menu.file.import'), executeCommand('file.import-file')),
    item(t('menu.file.export'), () => {}, {
      enabled: hasFile,
      children: [
        item(t('menu.file.exportHtml'), () => bus.emit('showExportDialog', 'styledHtml')),
        item(t('menu.file.exportPdf'), () => bus.emit('showExportDialog', 'pdf')),
        item(t('menu.file.exportDocx'), () => bus.emit('showExportDialog', 'docx'))
      ]
    }),
    item(t('menu.file.print'), executeCommand('file.print'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.print') }),
    sep(),
    item(t('menu.file.preferences'), executeCommand('file.preferences'), { hint: hintFor(useCommandCenterStore(), 'file.preferences') }),
    sep(),
    item(t('menu.file.closeTab'), executeCommand('file.close-tab'), { enabled: hasFile, hint: hintFor(useCommandCenterStore(), 'file.close-tab') }),
    item(t('menu.file.closeWindow'), executeCommand('file.close-window'), { hint: hintFor(useCommandCenterStore(), 'file.close-window') }),
    sep(),
    item(t('menu.file.quit'), executeCommand('file.quit'))
  ]
}

const editAction = (label: string, type: string, opts: ItemOptions = {}): MenuItemDef =>
  item(label, focusThen(() => bus.emit('mt::editor-edit-action', type)), opts)

const buildEditMenu = (hasFile: boolean): MenuItemDef[] => {
  const commandCenter = useCommandCenterStore()
  const editorStore = useEditorStore()
  const lineEnding = (editorStore.currentFile?.lineEnding ?? 'lf') as string

  return [
    editAction(t('menu.edit.undo'), 'undo', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.undo') }),
    editAction(t('menu.edit.redo'), 'redo', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.redo') }),
    sep(),
    editAction(t('menu.edit.cut'), 'cut', { hint: hintFor(commandCenter, 'edit.cut') }),
    editAction(t('menu.edit.copy'), 'copy', { hint: hintFor(commandCenter, 'edit.copy') }),
    editAction(t('menu.edit.paste'), 'paste', { hint: hintFor(commandCenter, 'edit.paste') }),
    sep(),
    editAction(t('menu.edit.copyAsRich'), 'copyAsRich', { enabled: hasFile }),
    editAction(t('menu.edit.copyAsHtml'), 'copyAsHtml', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.copy-as-html') }),
    editAction(t('menu.edit.pasteAsPlainText'), 'pasteAsPlainText', { hint: hintFor(commandCenter, 'edit.paste-as-plaintext') }),
    sep(),
    editAction(t('menu.edit.selectAll'), 'selectAll', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.select-all') }),
    sep(),
    editAction(t('menu.edit.duplicate'), 'duplicate', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.duplicate') }),
    editAction(t('menu.edit.createParagraph'), 'createParagraph', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.create-paragraph') }),
    editAction(t('menu.edit.deleteParagraph'), 'deleteParagraph', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.delete-paragraph') }),
    sep(),
    editAction(t('menu.edit.find'), 'find', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.find') }),
    editAction(t('menu.edit.findNext'), 'findNext', { enabled: hasFile }),
    editAction(t('menu.edit.findPrevious'), 'findPrev', { enabled: hasFile }),
    editAction(t('menu.edit.replace'), 'replace', { enabled: hasFile, hint: hintFor(commandCenter, 'edit.replace') }),
    sep(),
    editAction(t('menu.edit.findInFolder'), 'findInFolder', { hint: hintFor(commandCenter, 'edit.find-in-folder') }),
    sep(),
    item(t('menu.edit.lineEnding'), () => {}, {
      enabled: hasFile,
      children: [
        {
          type: 'radio',
          label: t('menu.edit.lineEndingLf'),
          checked: lineEnding.toLowerCase() === 'lf',
          enabled: hasFile,
          action: () => bus.emit('mt::set-line-ending', 'lf')
        },
        {
          type: 'radio',
          label: t('menu.edit.lineEndingCrlf'),
          checked: lineEnding.toLowerCase() === 'crlf',
          enabled: hasFile,
          action: () => bus.emit('mt::set-line-ending', 'crlf')
        }
      ]
    })
  ]
}

const buildParagraphMenu = (): MenuItemDef[] => {
  const commandCenter = useCommandCenterStore()
  const editorStore = useEditorStore()
  const hasFile = !!editorStore.currentFile
  // Source-code mode edits the raw markdown; the WYSIWYG paragraph transforms
  // are greyed out (mirrors `mt::set-editor-format-menus-enabled`).
  const state = usePreferencesStore().sourceCode
    ? null
    : editorStore.selectionMenuState ?? DEFAULT_SELECTION_STATE

  const p = (itemId: string, labelKey: string, actionType: string): MenuItemDef =>
    paragraphItem(state, hasFile, itemId, t(labelKey), actionType, hintFor(commandCenter, `paragraph.${itemId === 'code-fences' ? 'code-fence' : itemId}`))

  const hint = (commandId: string): string | undefined => hintFor(commandCenter, commandId)

  return [
    p('heading-1', 'menu.paragraph.heading1', 'heading 1'),
    p('heading-2', 'menu.paragraph.heading2', 'heading 2'),
    p('heading-3', 'menu.paragraph.heading3', 'heading 3'),
    p('heading-4', 'menu.paragraph.heading4', 'heading 4'),
    p('heading-5', 'menu.paragraph.heading5', 'heading 5'),
    p('heading-6', 'menu.paragraph.heading6', 'heading 6'),
    sep(),
    item(t('menu.paragraph.promoteHeading'), focusThen(() => bus.emit('paragraph', 'upgrade heading')), { enabled: hasFile, hint: hint('paragraph.upgrade-heading') }),
    item(t('menu.paragraph.demoteHeading'), focusThen(() => bus.emit('paragraph', 'degrade heading')), { enabled: hasFile, hint: hint('paragraph.degrade-heading') }),
    sep(),
    p('table', 'menu.paragraph.table', 'table'),
    p('code-fences', 'menu.paragraph.codeFences', 'pre'),
    p('quote-block', 'menu.paragraph.quoteBlock', 'blockquote'),
    p('math-block', 'menu.paragraph.mathBlock', 'mathblock'),
    p('html-block', 'menu.paragraph.htmlBlock', 'html'),
    sep(),
    p('order-list', 'menu.paragraph.orderedList', 'ol-order'),
    p('bullet-list', 'menu.paragraph.bulletList', 'ul-bullet'),
    p('task-list', 'menu.paragraph.taskList', 'ul-task'),
    sep(),
    p('loose-list-item', 'menu.paragraph.looseListItem', 'loose-list-item'),
    sep(),
    p('paragraph', 'menu.paragraph.paragraph', 'paragraph'),
    p('horizontal-line', 'menu.paragraph.horizontalRule', 'hr'),
    p('front-matter', 'menu.paragraph.frontMatter', 'front-matter')
  ]
}

const buildFormatMenu = (): MenuItemDef[] => {
  const commandCenter = useCommandCenterStore()
  const editorStore = useEditorStore()
  const preferencesStore = usePreferencesStore()
  const hasFile = !!editorStore.currentFile
  const state = preferencesStore.sourceCode ? null : editorStore.selectionMenuState
  const formats = editorStore.selectionFormatState ?? {}

  // Mirrors `updateSelectionMenus`: all items enabled by default, everything
  // disabled inside code-like blocks, link/image off across a multi-block
  // selection, and the whole menu off in source-code mode.
  const baseEnabled = hasFile && !preferencesStore.sourceCode && !!state && !state.isDisabled && !state.isCodeFences
  const fmt = (labelKey: string, formatType: string, commandId?: string): MenuItemDef => {
    let enabled = baseEnabled
    if (enabled && state?.isMultiline && (formatType === 'link' || formatType === 'image')) {
      enabled = false
    }
    return {
      type: 'checkbox',
      label: t(labelKey),
      checked: !!formats[formatType],
      enabled,
      hint: commandId ? hintFor(commandCenter, commandId) : undefined,
      action: focusThen(() => bus.emit('format', formatType))
    }
  }

  return [
    fmt('menu.format.bold', 'strong', 'format.strong'),
    fmt('menu.format.italic', 'em', 'format.emphasis'),
    fmt('menu.format.underline', 'u', 'format.underline'),
    sep(),
    fmt('menu.format.superscript', 'sup', 'format.superscript'),
    fmt('menu.format.subscript', 'sub', 'format.subscript'),
    fmt('menu.format.highlight', 'mark', 'format.highlight'),
    sep(),
    fmt('menu.format.inlineCode', 'inline_code', 'format.inline-code'),
    fmt('menu.format.inlineMath', 'inline_math', 'format.inline-math'),
    sep(),
    fmt('menu.format.strikethrough', 'del', 'format.strike'),
    fmt('menu.format.hyperlink', 'link', 'format.hyperlink'),
    fmt('menu.format.image', 'image', 'format.image'),
    sep(),
    item(t('menu.format.clearFormat'), focusThen(() => bus.emit('format', 'clear')), {
      enabled: baseEnabled,
      hint: hintFor(commandCenter, 'format.clear-format')
    })
  ]
}

const buildViewMenu = (): MenuItemDef[] => {
  const commandCenter = useCommandCenterStore()
  const preferencesStore = usePreferencesStore()
  const layoutStore = useLayoutStore()
  const hint = (commandId: string): string | undefined => hintFor(commandCenter, commandId)

  const zoomStep = (delta: number): void => {
    const zoom = typeof preferencesStore.zoom === 'number' ? preferencesStore.zoom : 1.0
    bus.emit('mt::window-zoom', Math.min(2.0, Math.max(0.5, Math.round((zoom + delta) * 1000) / 1000)))
  }

  return [
    item(t('menu.view.commandPalette'), () => bus.emit('show-command-palette'), { hint: hint('view.command-palette') }),
    sep(),
    checkbox(t('menu.view.sourceCodeMode'), !!preferencesStore.sourceCode, executeCommand('view.source-code-mode'), { hint: hint('view.source-code-mode') }),
    checkbox(t('menu.view.typewriterMode'), !!preferencesStore.typewriter, executeCommand('view.typewriter-mode'), { hint: hint('view.typewriter-mode') }),
    checkbox(t('menu.view.focusMode'), !!preferencesStore.focus, executeCommand('view.focus-mode'), { hint: hint('view.focus-mode') }),
    sep(),
    checkbox(t('menu.view.toggleSidebar'), !!layoutStore.showSideBar, executeCommand('view.toggle-sidebar'), { hint: hint('view.toggle-sidebar') }),
    checkbox(t('menu.view.toggleTabbar'), !!layoutStore.showTabBar, executeCommand('view.toggle-tabbar'), { hint: hint('view.toggle-tabbar') }),
    checkbox(
      t('menu.view.toggleTableOfContents'),
      layoutStore.rightColumn === 'toc' && !!layoutStore.showSideBar,
      () => {
        // Typora semantics: opening the outline shows the sidebar with the TOC
        // tab; invoking it again while the outline is open hides the sidebar.
        if (layoutStore.rightColumn === 'toc' && layoutStore.showSideBar) {
          layoutStore.SET_LAYOUT({ showSideBar: false })
        } else {
          layoutStore.SET_LAYOUT({ rightColumn: 'toc', showSideBar: true })
        }
      },
      { hint: hint('view.toggle-toc') }
    ),
    item(t('menu.view.reloadImages'), () => {
      bus.emit('invalidate-image-cache')
    }, { hint: hint('view.reload-images') }),
    sep(),
    item(t('menu.window.minimize'), executeCommand('window.minimize'), { hint: hint('window.minimize') }),
    item(t('menu.window.zoomIn'), () => zoomStep(0.125)),
    item(t('menu.window.zoomOut'), () => zoomStep(-0.125)),
    item(t('menu.window.resetZoom'), () => bus.emit('mt::window-zoom', 1.0)),
    item(t('menu.window.fullScreen'), executeCommand('window.toggle-full-screen'), { hint: hint('window.toggle-full-screen') })
  ]
}

const buildThemeMenu = (): MenuItemDef[] => {
  const preferencesStore = usePreferencesStore()
  const followSystem = !!preferencesStore.followSystemTheme
  const currentTheme = preferencesStore.theme as string

  const selectTheme = (themeId: string): (() => void) => () => {
    window.electron.ipcRenderer.send('mt::set-user-preference', { theme: themeId })
  }

  const themeRadio = ([labelKey, id]: readonly [string, string]): MenuItemDef => ({
    type: 'radio',
    label: t(`menu.theme.${labelKey}`),
    checked: currentTheme === id,
    enabled: !followSystem,
    action: selectTheme(id)
  })

  return [
    checkbox(t('preferences.theme.followSystemTheme'), followSystem, () => {
      window.electron.ipcRenderer.send('mt::set-user-preference', {
        followSystemTheme: !followSystem
      })
    }),
    sep(),
    // Locale values carry decorative dashes ("— 浅色主题 —") from the flat
    // native menu; strip them for the drawn submenu headers.
    item(t('menu.theme.lightThemes').replace(/—/g, '').trim(), () => {}, { children: LIGHT_THEMES.map(themeRadio) }),
    item(t('menu.theme.darkThemes').replace(/—/g, '').trim(), () => {}, { children: DARK_THEMES.map(themeRadio) })
  ]
}

const buildHelpMenu = (): MenuItemDef[] => {
  const openExternal = (url: string) => (): void => {
    window.electron.shell.openExternal(url)
  }

  const items: MenuItemDef[] = [
    item(t('menu.help.markdownReference'), openExternal('https://github.com/TheQYQ/ColaMD/docs/markdown-syntax')),
    item(t('menu.help.changelog'), openExternal('https://github.com/TheQYQ/ColaMD/releases')),
    sep(),
    item(t('menu.help.followUs'), openExternal('https://twitter.com/colamdapp')),
    item(t('menu.help.support'), openExternal('https://github.com/sponsors/colamd')),
    sep(),
    item(t('menu.help.askQuestion'), openExternal('https://github.com/TheQYQ/ColaMD/discussions')),
    item(t('menu.help.reportBug'), openExternal('https://github.com/TheQYQ/ColaMD/issues')),
    item(t('menu.help.viewSource'), openExternal('https://github.com/TheQYQ/ColaMD')),
    sep(),
    item(t('menu.help.license'), openExternal('https://github.com/TheQYQ/ColaMD/blob/develop/LICENSE'))
  ]

  if (window.electron?.isUpdatable) {
    items.push(sep(), item(t('menu.help.checkUpdates'), executeCommand('file.check-update')))
  }

  items.push(sep(), item(t('menu.help.about'), () => bus.emit('aboutDialog')))
  return items
}

/**
 * Builds the seven top-level menus. `recentFiles` is provided (and refreshed)
 * by the menu bar when the File menu opens — it is main-process state fetched
 * via `mt::menu::get-recent-documents`.
 */
export const buildMenus = (recentFiles: string[]): MenuTopDef[] => {
  const editorStore = useEditorStore()
  const hasFile = !!editorStore.currentFile
  const cleanLabel = (label: string): string =>
    label.replace(/\(&[A-Za-z]\)/g, '').replace(/&/g, '')

  return [
    { id: 'file', label: cleanLabel(t('menu.file.file')), items: () => buildFileMenu(recentFiles, hasFile) },
    { id: 'edit', label: cleanLabel(t('menu.edit.edit')), items: () => buildEditMenu(hasFile) },
    { id: 'paragraph', label: cleanLabel(t('menu.paragraph.title')), items: () => buildParagraphMenu() },
    { id: 'format', label: cleanLabel(t('menu.format.format')), items: () => buildFormatMenu() },
    { id: 'view', label: cleanLabel(t('menu.view.view')), items: () => buildViewMenu() },
    { id: 'theme', label: cleanLabel(t('menu.theme.theme')), items: () => buildThemeMenu() },
    { id: 'help', label: cleanLabel(t('menu.help.help')), items: () => buildHelpMenu() }
  ]
}
