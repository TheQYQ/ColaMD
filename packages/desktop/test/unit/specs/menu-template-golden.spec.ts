import { describe, expect, it, vi } from 'vitest'

// Golden-shape lock for the four main-menu templates whose entry bodies are all
// the same seven lines: label, accelerator, `click -> action(focusedWindow)`.
// `GOLDEN` below was produced by one throwaway capture run against the templates
// as they stood; it is written to be *failed*, not edited. Anything that changes
// an entry's label, id, type, accelerator, visibility, order, or which action a
// click reaches with which arguments shows up here -- including the click
// wiring, which no diff of the shape can reveal by reading it.

const win = { id: 'main-window' }

const h = vi.hoisted(() => {
  const calls: string[] = []
  const fmt = (a: unknown): string => {
    if (a === null) return 'null'
    if (a === undefined) return 'undefined'
    if (typeof a === 'object') return `<win ${(a as { id?: string }).id ?? '?'}>`
    return JSON.stringify(a)
  }
  const seen = new Set<string>()
  const proxy = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string | symbol) => {
      // `then` must stay undefined: a mock module that looks thenable is awaited
      // by the mocker, and it resolves to nothing.
      if (typeof name === 'symbol' || name === 'then' || name === '__esModule') return undefined
      if (name === 'default') return proxy
      seen.add(name)
      return (...args: unknown[]) => {
        calls.push(`${String(name)}(${args.map(fmt).join(', ')})`)
      }
    },
    // Vitest refuses unknown named exports unless the mock object answers for
    // them; `has` plus a growing `ownKeys` lets any action name through and
    // records which ones were asked for.
    has: (_t, name) => typeof name === 'string',
    ownKeys: () => [...seen]
  })
  return { calls, proxy }
})

// `file.ts` imports `app` as a value (its Quit entry is `click: app.quit`); the
// other electron imports in these templates are type-only.
vi.mock('electron', () => ({
  app: {
    quit: () => {
      h.calls.push('app.quit()')
    }
  }
}))
vi.mock('main_renderer/config', () => ({ isOsx: false }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('main_renderer/commands', () => ({
  COMMANDS: new Proxy(
    {},
    {
      get: (_t, name: string | symbol) => String(name)
    }
  )
}))
vi.mock('main_renderer/menu/actions/file', () => h.proxy)
vi.mock('main_renderer/menu/actions/edit', () => h.proxy)
vi.mock('main_renderer/menu/actions/paragraph', () => h.proxy)
vi.mock('main_renderer/menu/actions/format', () => h.proxy)
vi.mock('main_renderer/menu/actions/colamd', () => h.proxy)

// Every accelerator key echoes back through the name, so an entry that asks for
// the wrong binding shows up in the golden.
const keybindings = { getAccelerator: (key: string) => `A(${key})` } as never

interface RawItem {
  label?: string
  id?: string
  type?: string
  role?: string
  accelerator?: string
  visible?: boolean
  submenu?: RawItem[]
  click?: (menuItem: unknown, browserWindow: unknown) => void
}

// One line per entry: the i18n key, then only the fields that are set, then the
// action the click reaches. Nested submenus are indented.
const shape = (items: RawItem[], depth = 0): string[] => {
  const pad = '  '.repeat(depth)
  const out: string[] = []
  for (const item of items) {
    if (item.type === 'separator') {
      out.push(`${pad}|`)
      continue
    }
    h.calls.length = 0
    item.click?.({ label: item.label }, win)
    const fields = [
      item.label,
      item.id ? `#${item.id}` : '',
      item.type ? `:${item.type}` : '',
      item.role ? `@${item.role}` : '',
      item.accelerator ? `acc=${item.accelerator}` : '',
      item.visible === undefined ? '' : `visible=${item.visible}`
    ]
      .filter(Boolean)
      .join(' ')
    out.push(`${pad}${fields}${h.calls.length ? ` -> ${h.calls.join('; ')}` : ''}`)
    if (item.submenu) out.push(...shape(item.submenu, depth + 1))
  }
  return out
}

async function build(module: string): Promise<RawItem[]> {
  const mod = (await import(`main_renderer/menu/templates/${module}`)) as {
    default: (kb: never, pref?: never, recent?: string[]) => { submenu?: RawItem[] }
  }
  // `file.ts` reads the preference store and the recent-file list; the others
  // only take the keybindings. The extra arguments are ignored there.
  return mod.default(keybindings, { getAll: () => ({ autoSave: true }) } as never, [
    '/recent/a.md',
    '/recent/b.md'
  ]).submenu!
}

const GOLDEN: Record<string, string[]> = {
  file: [
    'menu.file.newTab acc=A(file.new-tab) -> newBlankTab(<win main-window>)',
    'menu.file.newWindow acc=A(file.new-window) -> newEditorWindow()',
    '|',
    'menu.file.openFile acc=A(file.open-file) -> openFile(<win main-window>)',
    'menu.file.openFolder acc=A(file.open-folder) -> openFolder(<win main-window>)',
    'menu.file.openRecent',
    '  /recent/a.md -> openFileOrFolder(<win main-window>, "/recent/a.md")',
    '  /recent/b.md -> openFileOrFolder(<win main-window>, "/recent/b.md")',
    '  |',
    '  menu.file.clearRecentlyUsed -> clearRecentlyUsed()',
    '|',
    'menu.file.save acc=A(file.save) -> save(<win main-window>)',
    'menu.file.saveAs acc=A(file.save-as) -> saveAs(<win main-window>)',
    'menu.file.autoSave #autoSaveMenuItem :checkbox -> autoSave(<win ?>, <win main-window>)',
    '|',
    'menu.file.moveTo acc=A(file.move-file) -> moveTo(<win main-window>)',
    'menu.file.rename acc=A(file.rename-file) -> rename(<win main-window>)',
    '|',
    'menu.file.import -> importFile(<win main-window>)',
    'menu.file.export',
    '  menu.file.exportHtml -> exportFile(<win main-window>, "styledHtml")',
    '  menu.file.exportPdf acc=A(file.export-file.pdf) -> exportFile(<win main-window>, "pdf")',
    '  menu.file.exportDocx -> exportFile(<win main-window>, "docx")',
    '  menu.file.exportImage -> exportFile(<win main-window>, "png")',
    '  |',
    '  menu.file.exportEpub -> exportFile(<win main-window>, "epub")',
    '  menu.file.exportLatex -> exportFile(<win main-window>, "latex")',
    '  menu.file.exportRtf -> exportFile(<win main-window>, "rtf")',
    '  menu.file.exportOpml -> exportFile(<win main-window>, "opml")',
    'menu.file.print acc=A(file.print) -> printDocument(<win main-window>)',
    '|',
    'menu.file.preferences acc=A(file.preferences) visible=true -> userSetting()',
    '|',
    'menu.file.closeTab acc=A(file.close-tab) -> closeTab(<win main-window>)',
    'menu.file.closeWindow acc=A(file.close-window) -> closeWindow(<win main-window>)',
    '|',
    'menu.file.quit acc=A(file.quit) visible=true -> app.quit()'
  ],
  edit: [
    'menu.edit.undo acc=A(EDIT_UNDO) -> editorUndo(<win main-window>)',
    'menu.edit.redo acc=A(EDIT_REDO) -> editorRedo(<win main-window>)',
    '|',
    'menu.edit.cut acc=A(EDIT_CUT) -> nativeCut(<win main-window>)',
    'menu.edit.copy acc=A(EDIT_COPY) -> nativeCopy(<win main-window>)',
    'menu.edit.paste acc=A(EDIT_PASTE) -> nativePaste(<win main-window>)',
    '|',
    'menu.edit.copyAsRich acc=A(EDIT_COPY_AS_RICH) -> editorCopyAsRich(<win main-window>)',
    'menu.edit.copyAsHtml acc=A(EDIT_COPY_AS_HTML) -> editorCopyAsHtml(<win main-window>)',
    'menu.edit.pasteAsPlainText acc=A(EDIT_PASTE_AS_PLAINTEXT) -> editorPasteAsPlainText(<win main-window>)',
    '|',
    'menu.edit.selectAll acc=A(EDIT_SELECT_ALL) -> editorSelectAll(<win main-window>)',
    '|',
    'menu.edit.duplicate acc=A(EDIT_DUPLICATE) -> editorDuplicate(<win main-window>)',
    'menu.edit.createParagraph acc=A(EDIT_CREATE_PARAGRAPH) -> editorCreateParagraph(<win main-window>)',
    'menu.edit.deleteParagraph acc=A(EDIT_DELETE_PARAGRAPH) -> editorDeleteParagraph(<win main-window>)',
    '|',
    'menu.edit.find acc=A(EDIT_FIND) -> editorFind(<win main-window>)',
    'menu.edit.findNext acc=A(EDIT_FIND_NEXT) -> editorFindNext(<win main-window>)',
    'menu.edit.findPrevious acc=A(EDIT_FIND_PREVIOUS) -> editorFindPrevious(<win main-window>)',
    'menu.edit.replace acc=A(EDIT_REPLACE) -> editorReplace(<win main-window>)',
    '|',
    'menu.edit.screenshot #screenshot acc=A(EDIT_SCREENSHOT) visible=false -> screenshot(<win main-window>)',
    '|',
    'menu.edit.lineEnding',
    '  menu.edit.lineEndingCrlf #crlfLineEndingMenuEntry :radio -> lineEnding(<win main-window>, "crlf")',
    '  menu.edit.lineEndingLf #lfLineEndingMenuEntry :radio -> lineEnding(<win main-window>, "lf")'
  ],
  paragraph: [
    'menu.paragraph.heading1 #heading1MenuItem :checkbox acc=A(paragraph.heading-1) -> heading1(<win main-window>)',
    'menu.paragraph.heading2 #heading2MenuItem :checkbox acc=A(paragraph.heading-2) -> heading2(<win main-window>)',
    'menu.paragraph.heading3 #heading3MenuItem :checkbox acc=A(paragraph.heading-3) -> heading3(<win main-window>)',
    'menu.paragraph.heading4 #heading4MenuItem :checkbox acc=A(paragraph.heading-4) -> heading4(<win main-window>)',
    'menu.paragraph.heading5 #heading5MenuItem :checkbox acc=A(paragraph.heading-5) -> heading5(<win main-window>)',
    'menu.paragraph.heading6 #heading6MenuItem :checkbox acc=A(paragraph.heading-6) -> heading6(<win main-window>)',
    '|',
    'menu.paragraph.promoteHeading #upgradeHeadingMenuItem acc=A(paragraph.upgrade-heading) -> increaseHeading(<win main-window>)',
    'menu.paragraph.demoteHeading #degradeHeadingMenuItem acc=A(paragraph.degrade-heading) -> degradeHeading(<win main-window>)',
    '|',
    'menu.paragraph.table #tableMenuItem :checkbox acc=A(paragraph.table) -> table(<win main-window>)',
    'menu.paragraph.codeFences #codeFencesMenuItem :checkbox acc=A(paragraph.code-fence) -> codeFence(<win main-window>)',
    'menu.paragraph.quoteBlock #quoteBlockMenuItem :checkbox acc=A(paragraph.quote-block) -> quoteBlock(<win main-window>)',
    'menu.paragraph.mathBlock #mathBlockMenuItem :checkbox acc=A(paragraph.math-formula) -> mathFormula(<win main-window>)',
    'menu.paragraph.htmlBlock #htmlBlockMenuItem :checkbox acc=A(paragraph.html-block) -> htmlBlock(<win main-window>)',
    '|',
    'menu.paragraph.orderedList #orderListMenuItem :checkbox acc=A(paragraph.order-list) -> orderedList(<win main-window>)',
    'menu.paragraph.bulletList #bulletListMenuItem :checkbox acc=A(paragraph.bullet-list) -> bulletList(<win main-window>)',
    'menu.paragraph.taskList #taskListMenuItem :checkbox acc=A(paragraph.task-list) -> taskList(<win main-window>)',
    '|',
    'menu.paragraph.looseListItem #looseListItemMenuItem :checkbox acc=A(paragraph.loose-list-item) -> looseListItem(<win main-window>)',
    '|',
    'menu.paragraph.paragraph #paragraphMenuItem :checkbox acc=A(paragraph.paragraph) -> paragraph(<win main-window>)',
    'menu.paragraph.horizontalRule #horizontalLineMenuItem :checkbox acc=A(paragraph.horizontal-line) -> horizontalLine(<win main-window>)',
    'menu.paragraph.frontMatter #frontMatterMenuItem :checkbox acc=A(paragraph.front-matter) -> frontMatter(<win main-window>)'
  ],
  format: [
    'menu.format.bold #strongMenuItem :checkbox acc=A(format.strong) -> strong(<win main-window>)',
    'menu.format.italic #emphasisMenuItem :checkbox acc=A(format.emphasis) -> emphasis(<win main-window>)',
    'menu.format.underline #underlineMenuItem :checkbox acc=A(format.underline) -> underline(<win main-window>)',
    '|',
    'menu.format.superscript #superscriptMenuItem :checkbox acc=A(format.superscript) -> superscript(<win main-window>)',
    'menu.format.subscript #subscriptMenuItem :checkbox acc=A(format.subscript) -> subscript(<win main-window>)',
    'menu.format.highlight #highlightMenuItem :checkbox acc=A(format.highlight) -> highlight(<win main-window>)',
    '|',
    'menu.format.inlineCode #inlineCodeMenuItem :checkbox acc=A(format.inline-code) -> inlineCode(<win main-window>)',
    'menu.format.inlineMath #inlineMathMenuItem :checkbox acc=A(format.inline-math) -> inlineMath(<win main-window>)',
    '|',
    'menu.format.strikethrough #strikeMenuItem :checkbox acc=A(format.strike) -> strikethrough(<win main-window>)',
    'menu.format.hyperlink #hyperlinkMenuItem :checkbox acc=A(format.hyperlink) -> hyperlink(<win main-window>)',
    'menu.format.image #imageMenuItem :checkbox acc=A(format.image) -> image(<win main-window>)',
    '|',
    'menu.format.clearFormat acc=A(format.clear-format) -> clearFormat(<win main-window>)'
  ]
}

describe('menu template golden shape', () => {
  for (const group of ['file', 'edit', 'paragraph', 'format']) {
    it(`keeps the ${group} menu entries identical in shape`, async () => {
      const actual = shape(await build(group))
      expect(actual).toEqual(GOLDEN[group])
    })
  }
})
