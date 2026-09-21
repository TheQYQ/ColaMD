import path from 'path'
import { realpath } from 'fs/promises'

// =============================================================================
// Path scope enforcement for renderer-facing mutating IPC channels.
//
// The renderer is treated as a potentially-compromised origin (it renders
// untrusted markdown). Channels such as mt::fs::write-file / output-file /
// move / copy / unlink / empty-dir and mt::fs-trash-item would otherwise accept
// an arbitrary absolute path from the renderer. Without a scope check, a single
// XSS in the markdown content escalates to arbitrary file destruction or data
// exfiltration anywhere on disk.
//
// This module keeps a mutable set of "allowed roots" — directories the user
// explicitly granted via trusted flows (main-process dialogs, argv/CLI, the
// file tree inside an already-granted root, and configured app locations such
// as the image-folder preference and userDataPath). Every mutating channel
// routes its path(s) through `assertPathInScope`, which:
//
//   1. rejects non-strings, empty, and relative paths;
//   2. normalizes the path (resolving "." / "..");
//   3. when the path exists, resolves symlinks via realpath so a symlink
//      planted inside an allowed root cannot bounce the write outside it;
//   4. checks the (symlink-resolved) path is exactly, or is a subpath of, a
//      registered root — using case-insensitive comparison on Windows/macOS.
//
// Disclosure of *contents* and *names* goes through this module too:
// `mt::fs::read-file` and `mt::fs::readdir` are scope-checked (ipc/fs.ts), so a
// renderer can only read what the user opened or picked. The boolean probes
// (`is-file`, `is-directory`, `path-exists`, `is-executable`, `paths::is-image`)
// stay open by decision, not oversight — see the comment at their registration
// site. The residual risk — a compromised renderer mutating files inside an
// already-granted root — is bounded by construction (it requires a root the user
// already opened).
//
// NOTE: root grants only happen at provably-trusted sites (dialog/argv/menu
// flows). Channels a compromised renderer can forge directly (e.g.
// mt::open-file-by-window-id) do NOT grant roots; they only open tabs. This
// prevents a renderer from widening its own mutation scope by "opening" an
// arbitrary file. The image-folder preference used to be the documented hole —
// it was renderer-settable through the generic preference channel while also
// granting a root. That is closed: DataCenter assigns the key from its folder
// dialog only (ignoring any path a caller sends), and `mt::set-user-preference`
// drops it. What remains is the risk above — mutating files inside a root the
// user already opened.
// =============================================================================

export class PathScopeError extends Error {
  constructor(
    public readonly candidate: string,
    message: string
  ) {
    super(message)
    this.name = 'PathScopeError'
  }
}

// Directories the renderer may mutate through the guarded channels.
const allowedRoots = new Set<string>()

// Windows (NTFS, case-insensitive) and macOS (APFS/HFS+, case-insensitive by
// default) treat "Docs" and "docs" as the same entry. Comparisons must mirror
// that, or a granted "C:\Docs" root would wrongly reject "c:\docs\file.md".
const foldCase = (p: string): string => {
  const platform = process.platform
  return platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p
}

/**
 * Register a directory as an allowed mutation root. The path is resolved and
 * stored in its canonical (trailing-slash-stripped) form.
 */
export function addAllowedRoot(dir: string): void {
  if (typeof dir !== 'string' || dir.length === 0) return
  allowedRoots.add(path.resolve(dir))
}

/** Return a snapshot of the currently-allowed roots. */
export function getAllowedRoots(): readonly string[] {
  return Array.from(allowedRoots)
}

/** Test-only: clear the root registry. */
export function clearAllowedRootsForTest(): void {
  allowedRoots.clear()
  canonicalRootCache.clear()
}

// Resolve the longest *existing* prefix of `p` via realpath, then re-append any
// non-existing tail. This makes a not-yet-existing target (new file/folder)
// canonicalize consistently with an existing one, and applies the same
// junction/symlink-following transformation to both candidate and root so the
// comparison below is source-consistent (platform volume-case form included).
const canonicalize = async (p: string): Promise<string> => {
  const abs = path.resolve(p)
  const tail: string[] = []
  let cursor = abs
  for (;;) {
    try {
      const resolved = await realpath(cursor)
      return tail.length ? path.join(resolved, ...tail.reverse()) : resolved
    } catch {
      const parent = path.dirname(cursor)
      if (parent === cursor) return abs
      tail.push(path.basename(cursor))
      cursor = parent
    }
  }
}

// Roots are stored in their raw resolved form (addAllowedRoot is sync and may
// run at startup). We canonicalize them lazily — realpath resolves the longest
// existing prefix and follows any junction/symlink (e.g. macOS /var →
// /private/var) so the comparison below uses the same source as the candidate.
// The cache avoids re-running realpath on every assertion against a stable root.
const canonicalRootCache = new Map<string, string>()

const getCanonicalRoots = async (): Promise<string[]> => {
  const out: string[] = []
  for (const root of allowedRoots) {
    let c = canonicalRootCache.get(root)
    if (!c) {
      c = await canonicalize(root)
      canonicalRootCache.set(root, c)
    }
    out.push(c)
  }
  return out
}

const isInScope = (resolved: string, roots: readonly string[]): boolean => {
  const folded = foldCase(resolved)
  for (const root of roots) {
    const fRoot = foldCase(root)
    if (folded === fRoot || folded.startsWith(fRoot + path.sep)) return true
    // Drive-root granted as "C:\" — path.resolve keeps the trailing sep only
    // for roots; guard against a stored "C:" (no sep) missing "C:\foo".
    if (fRoot.endsWith(path.sep) && folded.startsWith(fRoot)) return true
  }
  return false
}

/**
 * Assert that `candidate` is inside an allowed root. Returns the resolved path
 * (symlink-resolved when it exists) on success, throws {@link PathScopeError}
 * otherwise.
 *
 * Async because it performs a realpath when the target exists — sync realpath
 * would block the main thread. For not-yet-existing targets (new files /
 * folders) the normalized path is the best available answer; the usual TOCTOU
 * window applies and is accepted.
 */
export async function assertPathInScope(candidate: string): Promise<string> {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathScopeError(String(candidate), 'path must be a non-empty string')
  }
  if (!path.isAbsolute(candidate)) {
    throw new PathScopeError(candidate, 'path must be absolute')
  }

  // Canonicalize the candidate the same way we canonicalize registered roots:
  // resolve symlinks/junctions for the existing prefix and re-append any
  // not-yet-existing tail. A link planted inside an allowed root is therefore
  // resolved to its real target and rejected if that target lies outside.
  const resolved = await canonicalize(path.resolve(candidate))
  const roots = await getCanonicalRoots()

  if (!isInScope(resolved, roots)) {
    throw new PathScopeError(candidate, 'path is outside the allowed scope')
  }
  return resolved
}
