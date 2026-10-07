// Drop trust anchor (batch B).
//
// `mt::window::drop` ends at openFileOrFolder, which grants the parent dir of
// the dropped file — so the message must not be forgeable by page scripts.
// Verified by spike (2026-10-06, electron 42.1):
//   - webUtils.getPathForFile returns "" for JS-constructed Files, including
//     filenames that carry an absolute path (the forgery shape);
//   - a 'drop' listener registered from the preload's isolated world does
//     receive DOM drop events, and — preload scripts run before page scripts —
//     it fires first at the window target.
// So the preload computes paths from real drops and is the channel's only
// allowed sender; the page-facing `send` wrapper refuses the channel outright.

export const DROP_CHANNEL = 'mt::window::drop'

/** Channels page scripts may never trigger through the exposed send wrapper. */
const PAGE_BLOCKED_SEND_CHANNELS: ReadonlySet<string> = new Set([DROP_CHANNEL])

export const isPageSendAllowed = (channel: string): boolean =>
  !PAGE_BLOCKED_SEND_CHANNELS.has(channel)

/**
 * Paths of real dropped files. Entries without a native path (synthetic or
 * in-memory File objects) and files whose lookup throws are skipped — a drop
 * is a user gesture, not a place to fail loudly.
 */
export const collectDropPaths = (
  dataTransfer: DataTransfer | null | undefined,
  getPathForFile: (file: File) => string
): string[] => {
  if (!dataTransfer) return []

  // Same precedence the drop overlay used: a populated files list wins, and
  // items only fill the gap for sources that expose kind 'file' without
  // mirroring into files.
  const candidates: File[] =
    dataTransfer.files && dataTransfer.files.length > 0
      ? Array.from(dataTransfer.files)
      : Array.from(dataTransfer.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null)

  const out: string[] = []
  for (const file of candidates) {
    try {
      const p = getPathForFile(file)
      if (p) out.push(p)
    } catch {
      // synthetic file — no native handle to resolve
    }
  }
  return out
}

/**
 * The preload's own drop listener: converts a real OS drop into an IPC send.
 * Silent when nothing resolves to a path, so forged DragEvents produce no
 * message at all.
 */
export const installDropBridge = (
  target: Pick<Window, 'addEventListener'>,
  deps: { getPathForFile: (file: File) => string; send: (paths: string[]) => void }
): void => {
  target.addEventListener('drop', (event: Event) => {
    const paths = collectDropPaths((event as DragEvent).dataTransfer, deps.getPathForFile)
    if (paths.length > 0) deps.send(paths)
  })
}
