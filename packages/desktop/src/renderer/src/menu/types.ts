export type MenuItemType = 'separator' | 'item' | 'checkbox' | 'radio'

/**
 * A resolved menu item ready to render. The frameless HTML menu bar resolves
 * labels / checked / enabled state eagerly (mirroring the native menu state
 * updates in `main/menu/actions/*`); actions are the same calls the native
 * menu items or the renderer command center perform.
 */
export interface MenuItemDef {
  id?: string
  type: MenuItemType
  label?: string
  checked?: boolean
  enabled?: boolean
  /** Shortcut hint for display, e.g. "Ctrl+B". */
  hint?: string
  children?: MenuItemDef[]
  action?: () => void
}

export interface MenuTopDef {
  id: string
  label: string
  items: () => MenuItemDef[]
}
