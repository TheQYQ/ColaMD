import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

/** A menu entry whose whole job is to hand the focused window to an action. */
export type WindowAction = (browserWindow: BrowserWindow | undefined) => void

/**
 * One builder for the entry shape the menu templates repeated about sixty times
 * over: translated label, accelerator looked up by key, click that forwards the
 * focused window to an action.
 *
 * The window is cast because Electron hands a `BaseWindow` while the actions take
 * a `BrowserWindow`. Entries that need an `id`, a `type`, or a visibility rule
 * pass it as `extra`; an entry that needs the clicked menu item itself, not the
 * window, is not this shape and stays written out.
 *
 * Two things are worth knowing before changing this:
 *
 * - An empty `acceleratorKey` means no lookup and no property. Writing
 *   `accelerator: undefined` where a hand-written entry omitted the field is
 *   visible to Electron, and to `format-menu-state.spec.ts`, which counts
 *   accelerators by `'accelerator' in item`.
 * - `run` is read while the template is built, not when the entry is clicked.
 *   Specs that mock an actions module as an empty object therefore have to answer
 *   for the export names, because destructuring them is what fails.
 */
export const menuAction =
  (keybindings: Keybindings) =>
    (
      labelKey: string,
      acceleratorKey: string,
      run: WindowAction,
      extra?: Partial<MenuItemConstructorOptions>
    ): MenuItemConstructorOptions => ({
      label: t(labelKey),
    // No key at all means no lookup and no property: asking the handler for `''`
    // is not the same as not asking, and `accelerator: undefined` where the
    // hand-written entry omitted the field changes what Electron and the
    // accelerator-table tests see.
      ...(acceleratorKey
        ? { accelerator: keybindings.getAccelerator(acceleratorKey) ?? undefined }
        : {}),
      click: (_menuItem, browserWindow) => {
        run(browserWindow as BrowserWindow | undefined)
      },
      ...extra
    })
