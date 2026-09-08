import {
  Folder as FilesIcon,
  Search as SearchIcon,
  Memo as TocIcon,
  Clock as HistoryIcon,
  Setting as SettingIcon
} from '@element-plus/icons-vue'
import { t } from '@/i18n'
import { getRegisteredSidebarPanels } from '../../services/pluginRegistry'
import type { SidebarPanelRegistration } from '../../services/pluginRegistry'

export interface SideBarIconEntry {
  id: string
  name: () => string
  icon: unknown
}

export const sideBarIcons: SideBarIconEntry[] = [
  {
    id: 'files',
    name: () => t('sideBar.icons.files'),
    icon: FilesIcon
  },
  {
    id: 'search',
    name: () => t('sideBar.icons.search'),
    icon: SearchIcon
  },
  {
    id: 'toc',
    name: () => t('sideBar.icons.toc'),
    icon: TocIcon
  },
  {
    id: 'history',
    name: () => t('sideBar.icons.history'),
    icon: HistoryIcon
  }
]

export const sideBarBottomIcons: SideBarIconEntry[] = [
  {
    id: 'settings',
    name: () => t('sideBar.icons.settings'),
    icon: SettingIcon
  }
]

/**
 * Build the full list of sidebar icon entries, combining built-in icons with
 * plugin-registered panels. Plugins that registered via
 * `registerSidebarPanel(...)` get an icon in the left column and their panel
 * component renders in the right column when selected.
 *
 * Position handling:
 *   - 'top'    → before all built-in icons
 *   - 'inline' → interleaved alphabetically with built-ins (default)
 *   - 'bottom' → after built-ins, before the settings gear
 *
 * Bottom icons (settings gear) always stay at the very bottom.
 */
export function getAllSideBarIcons(): SideBarIconEntry[] {
  const plugins = getRegisteredSidebarPanels()

  const top = plugins.filter((p) => p.position === 'top')
  const inline = plugins.filter((p) => !p.position || p.position === 'inline')
  const bottom = plugins.filter((p) => p.position === 'bottom')

  const pluginToEntry = (p: SidebarPanelRegistration): SideBarIconEntry => ({
    id: p.id,
    name: () => p.name,
    icon: p.icon
  })

  return [
    ...top.map(pluginToEntry),
    ...sideBarIcons,
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
