import bus from '../bus'
import { registerSidebarPasteHandler, type SidebarClipboardEntry } from './sidebarPaste'
import { sidebarFail } from './sidebarFeedback'

export interface SidebarCreateCache {
  dirname: string
  type: string
}

export interface SidebarContextMenuContext {
  // Heterogeneous UI state: assigned file nodes, folder nodes, and the empty
  // "no selection" object/null across sidebar components; a single non-`any`
  // union breaks both the assignments and the field reads, so it stays a hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeItem: { value: any }
  createCache: { value: SidebarCreateCache | Record<string, never> }
  clipboard: { value: SidebarClipboardEntry | null }
  renameCache: { value: string | null }
}

/**
 * Every entry the sidebar's right-click menu fires, wired onto the shared refs.
 * Each handler only reads `activeItem` and stages state for the inline input or
 * the IPC call itself -- the renaming and creation that consume those caches
 * stay in the store, because they also have to touch the open tabs.
 */
export function registerSidebarContextMenuHandlers(ctx: SidebarContextMenuContext): void {
  bus.on('SIDEBAR::show-in-folder', () => {
    const { pathname } = ctx.activeItem.value
    window.electron.shell.showItemInFolder(pathname)
  })
  bus.on('SIDEBAR::new', (type: unknown) => {
    const { pathname, isDirectory } = ctx.activeItem.value
    const dirname = isDirectory ? pathname : window.path.dirname(pathname)
    ctx.createCache.value = { dirname, type: String(type) }
    bus.emit('SIDEBAR::show-new-input')
  })
  bus.on('SIDEBAR::remove', () => {
    const { pathname } = ctx.activeItem.value
    window.electron.ipcRenderer.invoke('mt::fs-trash-item', pathname).catch((err: unknown) => {
      sidebarFail('Error while deleting', err)
    })
  })
  bus.on('SIDEBAR::copy-cut', (type: unknown) => {
    const { pathname: src } = ctx.activeItem.value
    ctx.clipboard.value = { type: String(type), src }
  })
  registerSidebarPasteHandler({ activeItem: ctx.activeItem, clipboard: ctx.clipboard })
  bus.on('SIDEBAR::rename', () => {
    const { pathname } = ctx.activeItem.value
    ctx.renameCache.value = pathname
    bus.emit('SIDEBAR::show-rename-input')
  })
}
