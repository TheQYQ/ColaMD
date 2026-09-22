import { type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/edit'
import { menuAction } from './menuAction'
import { isOsx } from '../../config'
import { COMMANDS } from '../../commands'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function (keybindings: Keybindings): MenuItemConstructorOptions {
  const item = menuAction(keybindings)
  return {
    label: t('menu.edit.edit'),
    submenu: [
      item('menu.edit.undo', COMMANDS.EDIT_UNDO, actions.editorUndo),
      item('menu.edit.redo', COMMANDS.EDIT_REDO, actions.editorRedo),
      { type: 'separator' },
      item('menu.edit.cut', COMMANDS.EDIT_CUT, actions.nativeCut),
      item('menu.edit.copy', COMMANDS.EDIT_COPY, actions.nativeCopy),
      item('menu.edit.paste', COMMANDS.EDIT_PASTE, actions.nativePaste),
      { type: 'separator' },
      item('menu.edit.copyAsRich', COMMANDS.EDIT_COPY_AS_RICH, actions.editorCopyAsRich),
      item('menu.edit.copyAsHtml', COMMANDS.EDIT_COPY_AS_HTML, actions.editorCopyAsHtml),
      item(
        'menu.edit.pasteAsPlainText',
        COMMANDS.EDIT_PASTE_AS_PLAINTEXT,
        actions.editorPasteAsPlainText
      ),
      { type: 'separator' },
      item('menu.edit.selectAll', COMMANDS.EDIT_SELECT_ALL, actions.editorSelectAll),
      { type: 'separator' },
      item('menu.edit.duplicate', COMMANDS.EDIT_DUPLICATE, actions.editorDuplicate),
      item(
        'menu.edit.createParagraph',
        COMMANDS.EDIT_CREATE_PARAGRAPH,
        actions.editorCreateParagraph
      ),
      item(
        'menu.edit.deleteParagraph',
        COMMANDS.EDIT_DELETE_PARAGRAPH,
        actions.editorDeleteParagraph
      ),
      { type: 'separator' },
      item('menu.edit.find', COMMANDS.EDIT_FIND, actions.editorFind),
      item('menu.edit.findNext', COMMANDS.EDIT_FIND_NEXT, actions.editorFindNext),
      item('menu.edit.findPrevious', COMMANDS.EDIT_FIND_PREVIOUS, actions.editorFindPrevious),
      item('menu.edit.replace', COMMANDS.EDIT_REPLACE, actions.editorReplace),
      { type: 'separator' },
      item('menu.edit.screenshot', COMMANDS.EDIT_SCREENSHOT, actions.screenshot, {
        id: 'screenshot',
        visible: isOsx
      }),
      {
        // Screenshot is macOS-only; hide its trailing separator too so
        // Windows/Linux don't show a doubled divider here (#2997).
        type: 'separator',
        visible: isOsx
      },
      {
        // TODO: Remove this menu entry and add it to the command palette (#1408).
        label: t('menu.edit.lineEnding'),
        submenu: [
          item('menu.edit.lineEndingCrlf', '', (bw) => actions.lineEnding(bw, 'crlf'), {
            id: 'crlfLineEndingMenuEntry',
            type: 'radio'
          }),
          item('menu.edit.lineEndingLf', '', (bw) => actions.lineEnding(bw, 'lf'), {
            id: 'lfLineEndingMenuEntry',
            type: 'radio'
          })
        ]
      }
    ]
  }
}
