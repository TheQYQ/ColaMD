import { type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/format'
import { menuAction, type WindowAction } from './menuAction'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function (keybindings: Keybindings): MenuItemConstructorOptions {
  const item = menuAction(keybindings)
  // Every entry but "Clear formatting" mirrors a mark the editor is holding.
  const box = (labelKey: string, kbKey: string, run: WindowAction, id: string) =>
    item(labelKey, kbKey, run, { id, type: 'checkbox' })
  return {
    id: 'formatMenuItem',
    label: t('menu.format.format'),
    submenu: [
      box('menu.format.bold', 'format.strong', actions.strong, 'strongMenuItem'),
      box('menu.format.italic', 'format.emphasis', actions.emphasis, 'emphasisMenuItem'),
      box('menu.format.underline', 'format.underline', actions.underline, 'underlineMenuItem'),
      { type: 'separator' },
      box(
        'menu.format.superscript',
        'format.superscript',
        actions.superscript,
        'superscriptMenuItem'
      ),
      box('menu.format.subscript', 'format.subscript', actions.subscript, 'subscriptMenuItem'),
      box('menu.format.highlight', 'format.highlight', actions.highlight, 'highlightMenuItem'),
      { type: 'separator' },
      box('menu.format.inlineCode', 'format.inline-code', actions.inlineCode, 'inlineCodeMenuItem'),
      box('menu.format.inlineMath', 'format.inline-math', actions.inlineMath, 'inlineMathMenuItem'),
      { type: 'separator' },
      box('menu.format.strikethrough', 'format.strike', actions.strikethrough, 'strikeMenuItem'),
      box('menu.format.hyperlink', 'format.hyperlink', actions.hyperlink, 'hyperlinkMenuItem'),
      box('menu.format.image', 'format.image', actions.image, 'imageMenuItem'),
      { type: 'separator' },
      item('menu.format.clearFormat', 'format.clear-format', actions.clearFormat)
    ]
  }
}
