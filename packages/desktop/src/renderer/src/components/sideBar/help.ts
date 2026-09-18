import { t } from '@/i18n'

export interface SideBarTabEntry {
  id: string
  name: () => string
}

/**
 * Built-in sidebar tabs: files + outline (目录). Rendered as a compact text
 * tab row at the top of the panel (no icon strip, no settings gear —
 * preferences live in the 文件 > 偏好设置 menu).
 */
export const sideBarTabs: SideBarTabEntry[] = [
  {
    id: 'files',
    name: () => t('sideBar.icons.files')
  },
  {
    id: 'toc',
    name: () => t('sideBar.icons.toc')
  }
]

export function getAllSideBarTabs(): SideBarTabEntry[] {
  return sideBarTabs
}
