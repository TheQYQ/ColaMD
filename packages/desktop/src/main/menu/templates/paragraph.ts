import { type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/paragraph'
import { menuAction, type WindowAction } from './menuAction'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function (keybindings: Keybindings): MenuItemConstructorOptions {
  const item = menuAction(keybindings)
  // Nearly every entry here reflects editor state, so it ticks and unticks.
  const box = (labelKey: string, kbKey: string, run: WindowAction, id: string) =>
    item(labelKey, kbKey, run, { id, type: 'checkbox' })
  return {
    id: 'paragraphMenuEntry',
    label: t('menu.paragraph.title'),
    submenu: [
      box('menu.paragraph.heading1', 'paragraph.heading-1', actions.heading1, 'heading1MenuItem'),
      box('menu.paragraph.heading2', 'paragraph.heading-2', actions.heading2, 'heading2MenuItem'),
      box('menu.paragraph.heading3', 'paragraph.heading-3', actions.heading3, 'heading3MenuItem'),
      box('menu.paragraph.heading4', 'paragraph.heading-4', actions.heading4, 'heading4MenuItem'),
      box('menu.paragraph.heading5', 'paragraph.heading-5', actions.heading5, 'heading5MenuItem'),
      box('menu.paragraph.heading6', 'paragraph.heading-6', actions.heading6, 'heading6MenuItem'),
      { type: 'separator' },
      item('menu.paragraph.promoteHeading', 'paragraph.upgrade-heading', actions.increaseHeading, {
        id: 'upgradeHeadingMenuItem'
      }),
      item('menu.paragraph.demoteHeading', 'paragraph.degrade-heading', actions.degradeHeading, {
        id: 'degradeHeadingMenuItem'
      }),
      { type: 'separator' },
      box('menu.paragraph.table', 'paragraph.table', actions.table, 'tableMenuItem'),
      box(
        'menu.paragraph.codeFences',
        'paragraph.code-fence',
        actions.codeFence,
        'codeFencesMenuItem'
      ),
      box(
        'menu.paragraph.quoteBlock',
        'paragraph.quote-block',
        actions.quoteBlock,
        'quoteBlockMenuItem'
      ),
      box(
        'menu.paragraph.mathBlock',
        'paragraph.math-formula',
        actions.mathFormula,
        'mathBlockMenuItem'
      ),
      box(
        'menu.paragraph.htmlBlock',
        'paragraph.html-block',
        actions.htmlBlock,
        'htmlBlockMenuItem'
      ),
      { type: 'separator' },
      box(
        'menu.paragraph.orderedList',
        'paragraph.order-list',
        actions.orderedList,
        'orderListMenuItem'
      ),
      box(
        'menu.paragraph.bulletList',
        'paragraph.bullet-list',
        actions.bulletList,
        'bulletListMenuItem'
      ),
      box('menu.paragraph.taskList', 'paragraph.task-list', actions.taskList, 'taskListMenuItem'),
      { type: 'separator' },
      box(
        'menu.paragraph.looseListItem',
        'paragraph.loose-list-item',
        actions.looseListItem,
        'looseListItemMenuItem'
      ),
      { type: 'separator' },
      box(
        'menu.paragraph.paragraph',
        'paragraph.paragraph',
        actions.paragraph,
        'paragraphMenuItem'
      ),
      box(
        'menu.paragraph.horizontalRule',
        'paragraph.horizontal-line',
        actions.horizontalLine,
        'horizontalLineMenuItem'
      ),
      box(
        'menu.paragraph.frontMatter',
        'paragraph.front-matter',
        actions.frontMatter,
        'frontMatterMenuItem'
      )
    ]
  }
}
