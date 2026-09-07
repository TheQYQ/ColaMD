import path from 'path'
import { realpath } from 'fs/promises'
import { pathExists } from 'fs-extra'

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
// Read-only channels (read-file / readdir / stat / …) are intentionally out of
// scope: they are gated elsewhere and excluding them keeps the blast radius of
// this module contained to *mutation*. The residual risk — a compromised
// renderer mutating files inside an already-granted root — is bounded by
// construction (it requires a root the user already opened).
//
// NOTE: root grants only happen at provably-trusted sites (dialog/argv/menu
// flows). Channels a compromised renderer can forge directly (e.g.
// mt::open-file-by-window-id) do NOT grant roots; they only open tabs. This
// prevents a renderer from widening its own mutation scope by "opening" an
// arbitrary file. Documented residual risk: the image-folder preference is
// renderer-settable via the generic set-user-preference IPC channel, so a
// compromised renderer could in principle widen its write scope by flipping
// that preference. That is materially smaller than the status quo (write
// anywhere with NO scope) and is accepted for this batch — future hardening
// should route folder picks through a dedicated dialog-verified channel.
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
}

const isInScope = (resolved: string): boolean => {
  const folded = foldCase(resolved)
  for (const root of allowedRoots) {
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

  let resolved = path.resolve(candidate)
  // Resolve symlinks so a link planted inside an allowed root cannot redirect
  // the mutation outside it. Missing target (e.g. new file) → keep normalized.
  if (await pathExists(resolved)) {
    try {
      resolved = await realpath(resolved)
    } catch {
      // Keep the normalized path if realpath fails unexpectedly.
    }
  }

  if (!isInScope(resolved)) {
    throw new PathScopeError(candidate, 'path is outside the allowed scope')
  }
  return resolved
}
