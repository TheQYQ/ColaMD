import { app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/file'
import { userSetting } from '../actions/colamd'
import { menuAction, type WindowAction } from './menuAction'
import { isOsx } from '../../config'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'
import type Preference from '../../preferences'

export default function (
  keybindings: Keybindings,
  userPreference: Preference,
  recentlyUsedFiles: string[]
): MenuItemConstructorOptions {
  const { autoSave } = userPreference.getAll() as { autoSave?: boolean }
  const item = menuAction(keybindings)
  // Three of these actions take `BrowserWindow | null` rather than undefined.
  const withNullOrWindow =
    (run: (browserWindow: BrowserWindow | null) => void): WindowAction =>
      (bw) =>
        run(bw ?? null)
  const exportAs = (
    labelKey: string,
    format: Parameters<typeof actions.exportFile>[1],
    kbKey = ''
  ): MenuItemConstructorOptions =>
    item(labelKey, kbKey, (bw) => actions.exportFile(bw as BrowserWindow | undefined, format))

  const submenu: MenuItemConstructorOptions[] = [
    item('menu.file.newTab', 'file.new-tab', actions.newBlankTab),
    item('menu.file.newWindow', 'file.new-window', () => {
      actions.newEditorWindow()
    }),
    { type: 'separator' },
    item('menu.file.openFile', 'file.open-file', withNullOrWindow(actions.openFile)),
    item('menu.file.openFolder', 'file.open-folder', withNullOrWindow(actions.openFolder))
  ]

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file.file'),
    submenu
  }

  if (!isOsx) {
    const recentlyUsedSubmenu: MenuItemConstructorOptions[] = []
    const recentlyUsedMenu: MenuItemConstructorOptions = {
      label: t('menu.file.openRecent'),
      submenu: recentlyUsedSubmenu
    }

    for (const entry of recentlyUsedFiles) {
      recentlyUsedSubmenu.push({
        label: entry,
        click(menuItem, browserWindow) {
          if (browserWindow) {
            actions.openFileOrFolder(browserWindow as BrowserWindow, menuItem.label)
          }
        }
      })
    }

    recentlyUsedSubmenu.push(
      {
        type: 'separator',
        visible: recentlyUsedFiles.length > 0
      },
      {
        label: t('menu.file.clearRecentlyUsed'),
        enabled: recentlyUsedFiles.length > 0,
        click() {
          actions.clearRecentlyUsed()
        }
      }
    )
    submenu.push(recentlyUsedMenu)
  } else {
    submenu.push({
      // Electron accepts these MenuItem roles. The types stub camelCase
      // ('recentDocuments' / 'clearRecentDocuments') in recent versions; the JS
      // original used lowercase. Cast to satisfy strict role typing while
      // preserving the original runtime string.
      role: 'recentdocuments' as unknown as MenuItemConstructorOptions['role'],
      submenu: [
        {
          role: 'clearrecentdocuments' as unknown as MenuItemConstructorOptions['role']
        }
      ]
    })
  }

  submenu.push(
    { type: 'separator' },
    item('menu.file.save', 'file.save', actions.save),
    item('menu.file.saveAs', 'file.save-as', actions.saveAs),
    {
      label: t('menu.file.autoSave'),
      type: 'checkbox',
      checked: !!autoSave,
      id: 'autoSaveMenuItem',
      click(menuItem, browserWindow) {
        actions.autoSave(menuItem, browserWindow as BrowserWindow | undefined)
      }
    },
    { type: 'separator' },
    item('menu.file.moveTo', 'file.move-file', actions.moveTo),
    item('menu.file.rename', 'file.rename-file', actions.rename),
    { type: 'separator' },
    item('menu.file.import', '', withNullOrWindow(actions.importFile)),
    {
      label: t('menu.file.export'),
      submenu: [
        exportAs('menu.file.exportHtml', 'styledHtml'),
        exportAs('menu.file.exportPdf', 'pdf', 'file.export-file.pdf'),
        exportAs('menu.file.exportDocx', 'docx'),
        exportAs('menu.file.exportImage', 'png'),
        { type: 'separator' },
        exportAs('menu.file.exportEpub', 'epub'),
        exportAs('menu.file.exportLatex', 'latex'),
        exportAs('menu.file.exportRtf', 'rtf'),
        exportAs('menu.file.exportOpml', 'opml')
      ]
    },
    item('menu.file.print', 'file.print', actions.printDocument),
    { type: 'separator', visible: !isOsx },
    item(
      'menu.file.preferences',
      'file.preferences',
      () => {
        userSetting()
      },
      // The id is what makes the entry addressable — from a test, and from
      // anything else that needs to name it instead of match its label.
      { id: 'preferencesMenuItem', visible: !isOsx }
    ),
    { type: 'separator' },
    item('menu.file.closeTab', 'file.close-tab', actions.closeTab),
    item('menu.file.closeWindow', 'file.close-window', actions.closeWindow),
    { type: 'separator', visible: !isOsx },
    item(
      'menu.file.quit',
      'file.quit',
      () => {
        app.quit()
      },
      { visible: !isOsx }
    )
  )
  return fileMenu
}
