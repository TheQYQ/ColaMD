import { t } from '@/i18n'
import { getRegisteredSidebarPanels } from '../../services/pluginRegistry'
import type { SidebarPanelRegistration } from '../../services/pluginRegistry'

export interface SideBarTabEntry {
  id: string
  name: () => string
}

/**
 * Built-in sidebar tabs, in Typora order (文件 目录 搜索 历史记录): the two
 * navigation tabs (files + outline) come first, then the tools. Rendered as a
 * compact text tab row at the top of the panel (no icon strip, no settings
 * gear — preferences live in the 文件 > 偏好设置 menu).
 */
export const sideBarTabs: SideBarTabEntry[] = [
  {
    id: 'files',
    name: () => t('sideBar.icons.files')
  },
  {
    id: 'toc',
    name: () => t('sideBar.icons.toc')
  },
  {
    id: 'search',
    name: () => t('sideBar.icons.search')
  },
  {
    id: 'history',
    name: () => t('sideBar.icons.history')
  }
]

/**
 * Build the full list of sidebar tabs, combining built-ins with
 * plugin-registered panels (`registerSidebarPanel(...)`), which render as
 * additional tabs.
 *
 * Position handling: 'top' → before built-ins, 'inline' → after built-ins
 * (default), 'bottom' → last.
 */
export function getAllSideBarTabs(): SideBarTabEntry[] {
  const plugins = getRegisteredSidebarPanels()

  const top = plugins.filter((p) => p.position === 'top')
  const inline = plugins.filter((p) => !p.position || p.position === 'inline')
  const bottom = plugins.filter((p) => p.position === 'bottom')

  const pluginToEntry = (p: SidebarPanelRegistration): SideBarTabEntry => ({
    id: p.id,
    name: () => p.name
  })

  return [
    ...top.map(pluginToEntry),
    ...sideBarTabs,
    ...inline.map(pluginToEntry),
    ...bottom.map(pluginToEntry)
  ]
}

/**
 * Look up a plugin-registered panel by id. Used by the sidebar to render the
 * selected panel's component. Returns undefined for built-in panels (files,
 * search, toc, history) which the sidebar handles natively.
 */
export function getSidebarPanel(id: string): SidebarPanelRegistration | undefined {
  return getRegisteredSidebarPanels().find((p) => p.id === id)
}
