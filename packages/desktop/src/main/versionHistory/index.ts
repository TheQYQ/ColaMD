import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import writeFileAtomic from 'write-file-atomic'
import { ipcMain } from 'electron'
import type { VersionSnapshot } from '@shared/types/ipc'
import { typedHandle } from '../ipc/typedHandle'

interface VersionHistoryFile {
  pathname: string
  snapshots: VersionSnapshot[]
}

const MAX_SNAPSHOTS_PER_FILE = 50

/**
 * VersionHistoryStore persists per-file document snapshots ("version history")
 * to disk. The renderer triggers a snapshot on save / auto-save / idle / tab
 * close; the panel in the sidebar lists them and can restore any version.
 *
 * Layout on disk:
 *   `{userData}/version-history/{sha1(pathname)}.json`
 *
 * Each file is an atomic write (write-file-atomic) of `{ pathname, snapshots }`.
 * Snapshots are deduplicated against the newest entry — identical content is not
 * stored twice — and capped at MAX_SNAPSHOTS_PER_FILE (oldest dropped first).
 *
 * IPC registration is split into `registerIpcHandlers()` so the storage logic
 * stays unit-testable in a plain Node/jsdom environment (no Electron needed).
 */
class VersionHistoryStore {
  private readonly basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
    this._ensureDir()
  }

  /**
   * Wire up the IPC handlers that delegate to this instance's storage methods.
   * Call once from the main process after construction. No-op in test
   * environments where `ipcMain` is unavailable.
   */
  registerIpcHandlers(): void {
    if (typeof ipcMain === 'undefined' || !ipcMain.handle) return

    // Only `save` is wired to the renderer today — the renderer's version
    // history UI is read-side disabled. The storage methods (getSnapshots,
    // deleteSnapshot, …) remain as a tested public API on this class.
    typedHandle('mt::version-history:save', (_e, snapshot: VersionSnapshot) => {
      return this.saveSnapshot(snapshot)
    })
  }

  // ---------------------------------------------------------------------------
  // Public API (called via IPC in production, directly in tests)
  // ---------------------------------------------------------------------------

  /**
   * Persist a snapshot for `pathname`. Deduplicates against the latest entry
   * (no-op if content is byte-identical) and evicts the oldest once the cap is
   * hit. Returns the stored snapshot, or null when deduplicated away.
   */
  async saveSnapshot(snapshot: VersionSnapshot): Promise<VersionSnapshot | null> {
    const file = this._readFile(snapshot.pathname)

    const last = file.snapshots[file.snapshots.length - 1]
    if (last && last.markdown === snapshot.markdown) {
      return null
    }

    file.snapshots.push(snapshot)

    if (file.snapshots.length > MAX_SNAPSHOTS_PER_FILE) {
      file.snapshots.splice(0, file.snapshots.length - MAX_SNAPSHOTS_PER_FILE)
    }

    this._writeFile(snapshot.pathname, file)
    return snapshot
  }

  /** All snapshots for `pathname`, newest last. Returns [] when none exist. */
  getSnapshots(pathname: string): VersionSnapshot[] {
    return this._readFile(pathname).snapshots
  }

  /** Full markdown content of a single snapshot, or null when not found. */
  getSnapshotContent(pathname: string, id: string): string | null {
    const file = this._readFile(pathname)
    const snap = file.snapshots.find((s) => s.id === id)
    return snap ? snap.markdown : null
  }

  /** Remove one snapshot by id. Returns true if it existed and was removed. */
  deleteSnapshot(pathname: string, id: string): boolean {
    const file = this._readFile(pathname)
    const idx = file.snapshots.findIndex((s) => s.id === id)
    if (idx === -1) return false

    file.snapshots.splice(idx, 1)
    this._writeFile(pathname, file)
    return true
  }

  /** Drop the entire history for a file (e.g. when the user clears it). */
  clearHistory(pathname: string): boolean {
    const filePath = this._historyFilePath(pathname)
    if (!fs.existsSync(filePath)) return false

    try {
      fs.unlinkSync(filePath)
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _ensureDir(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true })
    }
  }

  /** SHA-1 of the absolute pathname → stable, cross-platform file name. */
  private _historyFileName(pathname: string): string {
    return `${crypto.createHash('sha1').update(pathname).digest('hex')}.json`
  }

  private _historyFilePath(pathname: string): string {
    return path.join(this.basePath, this._historyFileName(pathname))
  }

  private _readFile(pathname: string): VersionHistoryFile {
    const filePath = this._historyFilePath(pathname)
    if (!fs.existsSync(filePath)) {
      return { pathname, snapshots: [] }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as VersionHistoryFile
      if (!parsed || !Array.isArray(parsed.snapshots)) {
        return { pathname, snapshots: [] }
      }
      return { pathname, snapshots: parsed.snapshots }
    } catch {
      return { pathname, snapshots: [] }
    }
  }

  private _writeFile(pathname: string, file: VersionHistoryFile): void {
    const filePath = this._historyFilePath(pathname)
    writeFileAtomic.sync(filePath, JSON.stringify(file), 'utf8')
  }
}

export default VersionHistoryStore
