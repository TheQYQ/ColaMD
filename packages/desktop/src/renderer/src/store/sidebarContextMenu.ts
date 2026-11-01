import bus from '../bus'
import { registerSidebarPasteHandler, type SidebarClipboardEntry } from './sidebarPaste'
import notice from '@/services/notification'
import { t } from '../i18n'
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
    // UX-07 (#GUI-B10): confirm before trashing — a folder of work should not
    // vanish on a stray click. The success toast closes the loop the old
    // silent delete left open.
    const name = window.path.basename(pathname)
    notice
      .notify({
        title: t('sideBar.confirmDeleteTitle'),
        message: t('sideBar.confirmDeleteMessage', { name }),
        type: 'primary',
        showConfirm: true
      })
      .then(
        () => {
          // The confirm click resolves; the close button rejects, and a timeout
          // leaves it pending — both non-resolve paths mean "not now", so they
          // must not be mistaken for a failed trash below.
          window.electron.ipcRenderer
            .invoke('mt::fs-trash-item', pathname)
            .then(() => {
              notice.notify({
                title: t('sideBar.deleted'),
                type: 'primary',
                time: 3000
              })
            })
            .catch((err: unknown) => {
              sidebarFail(t('sideBar.errors.deleting'), err)
            })
        },
        () => undefined
      )
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
