import { getUniqueId, deepClone } from '../util'
import notice from '../services/notification'
import { t } from '../i18n'
import { usePreferencesStore } from './preferences'
import {
  isImageUnreferenced,
  resolveCleanupCandidate,
  type CleanupCandidate
} from '../util/imageCleanup'
import type { ImageAutoPathEntry } from '@shared/types/ipc'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(16) — what the desktop does with image references: ask main for completion
// candidates, and delete the file behind a reference the user removed. Moved out
// of the `actions` object in `editor.ts` verbatim; the store keeps one-line
// delegations and every internal call still goes through `store.*`.
//
// The deletion path is the one that destroys user data, so all three guards from
// `util/imageCleanup.ts` have to hold: the preference is opt-in, the file must
// live inside the document's own folder subtree or the configured image folder,
// and no open tab may still reference it. The debounce window exists because
// undo puts the reference back before the check fires.

// Pending unreferenced-image cleanup checks, keyed by absolute path. The
// delay gives undo (or a cut followed by an immediate paste-back) a window to
// restore the reference before the file is unlinked.
const imageCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
const IMAGE_CLEANUP_DELAY_MS = 5000

// Pending per-request replies, keyed by the correlation id the request carried.
// Main answers every request on the single static `mt::response-of-image-path`
// channel (the id rides in the payload, same shape as mt::response-file-move-to);
// the map routes each answer back to the promise that asked. This used to be a
// per-request `mt::response-of-image-path-${id}` channel built at runtime — no
// contract key could express it, and the listener had to be cast to accept it.
const pendingImageAutoPathReplies = new Map<string, (files: ImageAutoPathEntry[]) => void>()
let replyListenerInstalled = false

const ensureReplyListener = (): void => {
  // Unit tests import this module under jsdom, where window.electron does not
  // exist; the real renderer always has it, so install on the first real call.
  if (replyListenerInstalled || !window.electron) return
  replyListenerInstalled = true
  window.electron.ipcRenderer.on('mt::response-of-image-path', (_e, { id, files }) => {
    const resolve = pendingImageAutoPathReplies.get(id)
    if (!resolve) return
    pendingImageAutoPathReplies.delete(id)
    resolve(files)
  })
}

/** Ask main for the paths that complete `src`, answered on the static reply channel. */
export const askForImageAutoPath = (
  store: EditorStore,
  src: string
): Promise<ImageAutoPathEntry[]> => {
  if (!store.currentFile) return Promise.resolve([])
  const { pathname } = store.currentFile
  if (pathname) {
    let rs: (value: ImageAutoPathEntry[]) => void = () => {}
    const promise = new Promise<ImageAutoPathEntry[]>((resolve) => {
      rs = resolve
    })
    const id = getUniqueId()
    ensureReplyListener()
    pendingImageAutoPathReplies.set(id, rs)
    window.electron.ipcRenderer.send('mt::ask-for-image-auto-path', {
      pathname,
      src,
      id,
      currentFile: deepClone(store.currentFile)
    })
    return promise
  } else {
    return Promise.resolve([])
  }
}

/**
 * IMG.2: the engine removed the last markdown reference to an image. Schedule the
 * preference-gated cleanup — the reference check re-runs at fire time.
 */
export const imageDeleted = (store: EditorStore, { src }: { src: string }): void => {
  const preferencesStore = usePreferencesStore()
  if (!preferencesStore.deleteUnreferencedImages) return
  const tab = store.currentFile
  if (!tab?.pathname) return

  const documentDir = window.path.dirname(tab.pathname)
  const candidate = resolveCleanupCandidate(src, documentDir, preferencesStore.imageFolderPath, {
    path: window.path,
    isChildOfDirectory: window.fileUtils.isChildOfDirectory
  })
  if (!candidate) return

  const existing = imageCleanupTimers.get(candidate.absolutePath)
  if (existing) clearTimeout(existing)
  imageCleanupTimers.set(
    candidate.absolutePath,
    setTimeout(() => {
      imageCleanupTimers.delete(candidate.absolutePath)
      store.CLEANUP_UNREFERENCED_IMAGE(candidate).catch((err) => {
        console.error('Image cleanup failed:', err)
      })
    }, IMAGE_CLEANUP_DELAY_MS)
  )
}

export const cleanupUnreferencedImage = async (
  store: EditorStore,
  candidate: CleanupCandidate
): Promise<void> => {
  try {
    // The active tab's markdown may lag the engine (M1.2b lazy pipeline);
    // inactive tabs' markdown is static. Flush so the check sees the
    // post-deletion content.
    store.flushActiveEditor()
    const markdowns = store.tabs.map((t) => (typeof t.markdown === 'string' ? t.markdown : ''))
    if (!isImageUnreferenced(markdowns, candidate)) return
    if (!(await window.fileUtils.pathExists(candidate.absolutePath))) return
    await window.fileUtils.unlink(candidate.absolutePath)
    notice.notify({
      title: t('store.editor.imageCleanupTitle'),
      message: t('store.editor.imageCleanupMessage', {
        name: window.path.basename(candidate.absolutePath)
      }),
      showConfirm: false,
      time: 8000
    })
  } catch (err) {
    console.error('Failed to clean up unreferenced image:', err)
  }
}
