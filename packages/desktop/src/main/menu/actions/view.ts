import { ipcMain, type BrowserWindow, type Menu, type MenuItem } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { typedSend } from '../../ipc/typedSend'
import type { ViewLayoutPartial } from '@shared/types/ipc'

type Win = BrowserWindow | null | undefined

const typewriterModeMenuItemId = 'typewriterModeMenuItem'
const focusModeMenuItemId = 'focusModeMenuItem'

const toggleTypeMode = (win: Win, type: string): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::toggle-view-mode-entry', type)
  }
}

// The layout record is built with a computed key, so the emit casts to the
// contract's ViewLayoutPartial: `type` is one of the four layout keys and the
// value union is what the callers actually pass. The renderer consumes the
// same interface (store/layout.ts), so no side re-declares the shape.
const setLayout = (win: Win, type: string, value: string | boolean | number): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::set-view-layout', { [type]: value } as ViewLayoutPartial)
  }
}

const toggleLayout = (win: Win, type: string): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::toggle-view-layout-entry', type)
  }
}

export const debugToggleDevTools = (win: Win): void => {
  if (win && global.COLAMD_DEBUG) {
    win.webContents.toggleDevTools()
  }
}

export const debugReloadWindow = (win: Win): void => {
  if (win && global.COLAMD_DEBUG) {
    ipcMain.emit('window-reload-by-id', win.id)
  }
}

export const showCommandPalette = (win: Win): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::show-command-palette')
  }
}

export const toggleFocusMode = (win: Win): void => {
  toggleTypeMode(win, 'focus')
}

export const toggleSourceCodeMode = (win: Win): void => {
  toggleTypeMode(win, 'sourceCode')
}

export const toggleSidebar = (win: Win): void => {
  toggleLayout(win, 'showSideBar')
}

export const toggleTabBar = (win: Win): void => {
  toggleLayout(win, 'showTabBar')
}

export const showTabBar = (win: Win): void => {
  setLayout(win, 'showTabBar', true)
}

export const showTableOfContents = (win: Win): void => {
  setLayout(win, 'rightColumn', 'toc')
}

export const toggleTypewriterMode = (win: Win): void => {
  toggleTypeMode(win, 'typewriter')
}

export const reloadImageCache = (win: Win): void => {
  if (win && win.webContents) {
    typedSend(win.webContents, 'mt::invalidate-image-cache')
  }
}

// --- Commands -------------------------------------------------------------

export const loadViewCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.VIEW_COMMAND_PALETTE, showCommandPalette)
  commandManager.add(COMMANDS.VIEW_FOCUS_MODE, toggleFocusMode)
  commandManager.add(COMMANDS.VIEW_FORCE_RELOAD_IMAGES, reloadImageCache)
  commandManager.add(COMMANDS.VIEW_SOURCE_CODE_MODE, toggleSourceCodeMode)
  commandManager.add(COMMANDS.VIEW_TOGGLE_SIDEBAR, toggleSidebar)
  commandManager.add(COMMANDS.VIEW_TOGGLE_TABBAR, toggleTabBar)
  commandManager.add(COMMANDS.VIEW_TOGGLE_TOC, showTableOfContents)
  commandManager.add(COMMANDS.VIEW_TYPEWRITER_MODE, toggleTypewriterMode)

  commandManager.add(COMMANDS.VIEW_DEV_RELOAD, debugReloadWindow)
  commandManager.add(COMMANDS.VIEW_TOGGLE_DEV_TOOLS, debugToggleDevTools)
}

// --- IPC events -------------------------------------------------------------

// NOTE: Don't use static `getMenuItemById` here, instead request the menu by
//       window id from `AppMenu` manager.

/**
 * @param applicationMenu The application menu instance.
 * @param changes Array of changed view settings (e.g. [ {showSideBar: true} ]).
 */
export const viewLayoutChanged = (
  applicationMenu: Menu,
  changes: Record<string, unknown>
): void => {
  const disableMenuByName = (id: string, value: boolean): void => {
    const menuItem: MenuItem = applicationMenu.getMenuItemById(id)!
    menuItem.enabled = value
  }
  const changeMenuByName = (id: string, value: unknown): void => {
    const menuItem: MenuItem = applicationMenu.getMenuItemById(id)!
    menuItem.checked = !!value
  }

  for (const key in changes) {
    const value = changes[key]
    switch (key) {
      case 'showSideBar':
        changeMenuByName('sideBarMenuItem', value)
        break
      case 'showTabBar':
        changeMenuByName('tabBarMenuItem', value)
        break
      case 'sourceCode':
        changeMenuByName('sourceCodeModeMenuItem', !!value)
        disableMenuByName(focusModeMenuItemId, !value)
        disableMenuByName(typewriterModeMenuItemId, !value)
        break
      case 'typewriter':
        changeMenuByName(typewriterModeMenuItemId, value)
        break
      case 'focus':
        changeMenuByName(focusModeMenuItemId, value)
        break
    }
  }
}
