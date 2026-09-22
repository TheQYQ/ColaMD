import bus from '../bus'
import { paste, type PasteOptions } from '../util/fileSystem'
import { PATH_SEPARATOR } from '../config'
import { sidebarFail, sidebarWarn } from './sidebarFeedback'

export const MAX_COPIES = 99

export interface SidebarClipboardEntry {
  type: string
  src: string
  dest?: string
}

export interface SidebarPasteContext {
  activeItem: { value: { pathname: string; isDirectory?: boolean } }
  clipboard: { value: SidebarClipboardEntry | null }
}

/**
 * Copying a file into the folder it already lives in needs a new name, or the
 * paste would overwrite its own source. The app's convention is
 * `name (copy).ext`, then `name (copy 2).ext` and so on; `exists` is injected
 * because the real one is an async IPC probe. When the ceiling is reached the
 * caller must not paste, and `failure` carries the reason.
 */
export const resolveCopyDestination = async (
  src: string,
  dirname: string,
  exists: (pathname: string) => Promise<boolean>
): Promise<{ dest: string; failure?: string }> => {
  const ext = window.path.extname(src)
  const base = window.path.basename(src, ext)
  let dest = dirname + PATH_SEPARATOR + base + ' (copy)' + ext
  let suffix = 1
  while (await exists(dest)) {
    suffix++
    if (suffix > MAX_COPIES) {
      return {
        dest,
        failure: `Maximum of ${MAX_COPIES} copies reached. Please clean up first.`
      }
    }
    dest = dirname + PATH_SEPARATOR + base + ` (copy ${suffix})` + ext
  }
  return { dest }
}

/**
 * The sidebar's Paste entry: cut or copy lands in the active folder, and only a
 * copy onto its own folder has to invent a name.
 */
export function registerSidebarPasteHandler(ctx: SidebarPasteContext): void {
  bus.on('SIDEBAR::paste', async () => {
    const cb = ctx.clipboard.value
    const { pathname, isDirectory } = ctx.activeItem.value
    const dirname = isDirectory ? pathname : window.path.dirname(pathname)
    if (!cb || !cb.src) return

    let dest = dirname + PATH_SEPARATOR + window.path.basename(cb.src)

    if (window.path.normalize(cb.src) === window.path.normalize(dest)) {
      if (cb.type === 'cut') {
        sidebarWarn('Paste Forbidden', 'Source and destination must not be the same.')
        return
      }
      const resolved = await resolveCopyDestination(cb.src, dirname, (p) =>
        window.fileUtils.pathExists(p)
      )
      if (resolved.failure) {
        sidebarWarn('Too many copies', resolved.failure)
        return
      }
      dest = resolved.dest
    }

    cb.dest = dest

    paste(cb as PasteOptions)
      .then(() => {
        ctx.clipboard.value = null
      })
      .catch((err: unknown) => {
        sidebarFail('Error while pasting', err)
      })
  })
}
