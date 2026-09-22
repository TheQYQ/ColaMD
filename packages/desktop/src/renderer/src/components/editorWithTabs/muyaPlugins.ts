import {
  Muya,
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu
} from '@muyajs/core'

// The engine takes plugin callbacks as `Record<string, unknown>`
// (`packages/muya/src/muya.ts:121`), so this type only has to accept any
// function shape -- each callback keeps being type-checked where it is defined.
type Callback = (...args: never[]) => unknown

export interface MuyaPluginCallbacks {
  imageAction: Callback
  imagePathPicker: Callback
  imagePathAutoComplete: Callback
  jumpClick: Callback
}

let pluginsRegistered = false

/**
 * Registers the engine's UI plugins.
 *
 * `Muya.use(...)` appends to the static `Muya.plugins` array and every `init()`
 * instantiates the full list, so registration is process-global: without the
 * flag, remounting the editor in the same renderer (window reuse / HMR) would
 * register duplicate plugins and spawn duplicate UI handlers. The option
 * closures (`imageAction` / `jumpClick`) only read app-singleton Pinia stores,
 * so capturing them the first time round is correct.
 */
export function registerMuyaPlugins(cb: MuyaPluginCallbacks): void {
  if (pluginsRegistered) return
  pluginsRegistered = true

  Muya.use(TableChessboard)
  Muya.use(ParagraphQuickInsertMenu)
  Muya.use(CodeBlockLanguageSelector)
  Muya.use(EmojiSelector)
  Muya.use(ImagePathPicker)
  Muya.use(ImageEditTool, {
    imageAction: cb.imageAction,
    imagePathPicker: cb.imagePathPicker,
    imagePathAutoComplete: cb.imagePathAutoComplete
  })
  Muya.use(ImageResizeBar)
  Muya.use(ImageToolBar)
  Muya.use(InlineFormatToolbar)
  Muya.use(ParagraphFrontButton)
  Muya.use(ParagraphFrontMenu)
  Muya.use(PreviewToolBar)
  Muya.use(LinkTools, { jumpClick: cb.jumpClick })
  Muya.use(FootnoteTool)
  Muya.use(TableColumnToolbar)
  Muya.use(TableDragBar)
  Muya.use(TableRowColumMenu)
}
