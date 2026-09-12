/**
 * Unreferenced-image cleanup (IMG.2, WORKPLAN 第三梯队).
 *
 * When the engine reports `image-deleted` (the last markdown reference inside
 * the edited text was removed), the desktop may delete the underlying file —
 * but only when three guards pass:
 *
 *  1. **Path domain** — the file must live inside the document's own folder
 *     subtree or the configured global image folder. Arbitrary files outside
 *     those roots (e.g. a screenshot the user embedded from `C:\Windows\...`)
 *     are NEVER deleted.
 *  2. **No reference anywhere** — no open tab's markdown still mentions the
 *     image (as-written `src` or its absolute form). This covers undo (the
 *     reference comes back before the debounced check fires) and images shared
 *     between documents.
 *  3. **Preference** — `deleteUnreferencedImages` must be enabled (default
 *     off; deleting user files is opt-in).
 */

export interface CleanupCandidate {
  /** Absolute, platform-resolved path of the image file. */
  absolutePath: string
  /** The `src` exactly as written in markdown (the reference needle). */
  rawSrc: string
}

/**
 * Resolve a deleted image's `src` to a cleanup candidate, or null when the
 * source cannot map to a local file inside the allowed path domain.
 *
 * @param src             The `token.src` exactly as written (may be relative,
 *                        absolute, a `file://` URL, or data:/http(s) — the
 *                        latter two return null).
 * @param documentDir     Absolute directory of the current document.
 * @param imageFolder     Configured global image folder (may be empty).
 * @param deps            `path` — the platform path module (window.path);
 *                        `isChildOfDirectory` — dir/child containment check.
 */
export function resolveCleanupCandidate(
  src: string,
  documentDir: string,
  imageFolder: string,
  deps: {
    path: {
      resolve: (...parts: string[]) => string
      dirname: (p: string) => string
      extname: (p: string) => string
      isAbsolute: (p: string) => boolean
    }
    isChildOfDirectory: (dir: string, child: string) => boolean
  }
): CleanupCandidate | null {
  if (!src || /^data:/i.test(src) || /^https?:/i.test(src)) return null

  const { path, isChildOfDirectory } = deps

  let absolute: string
  if (/^file:\/\//i.test(src)) {
    // window.path is pathe-based (forward slashes everywhere); strip the
    // scheme and decode percent-escapes, then let resolve() normalize.
    try {
      absolute = path.resolve(decodeURIComponent(src.replace(/^file:\/\//i, '')))
    } catch {
      return null
    }
  } else if (path.isAbsolute(src)) {
    absolute = src
  } else {
    absolute = path.resolve(documentDir, src)
  }

  // Only image extensions are ever considered — this is a document-image
  // cleanup, not a general file deleter.
  const ext = path.extname(absolute).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.avif'].includes(ext)) {
    return null
  }

  // Path domain: document folder subtree or the configured image folder subtree.
  const inDocumentDir = isChildOfDirectory(documentDir, absolute)
  const inImageFolder =
    !!imageFolder && isChildOfDirectory(imageFolder, absolute)
  if (!inDocumentDir && !inImageFolder) return null

  return { absolutePath: absolute, rawSrc: src }
}

/**
 * True when NO markdown still references the image. The needle is checked
 * both as-written and (for relative sources) as a trailing path fragment of
 * any absolute reference, so a file shared across documents with different
 * relative bases is still detected.
 */
export function isImageUnreferenced(markdowns: string[], candidate: CleanupCandidate): boolean {
  const { absolutePath, rawSrc } = candidate
  const fileName = absolutePath.split(/[\\/]/).pop() ?? absolutePath
  return !markdowns.some((markdown) => {
    if (!markdown) return false
    if (markdown.includes(rawSrc)) return true
    if (markdown.includes(absolutePath)) return true
    // Same file referenced via a different relative base: match the unique
    // hash-named file itself (`…/<name>` appears inside any reference).
    return markdown.includes(fileName)
  })
}
