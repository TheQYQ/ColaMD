import fs from 'fs-extra'
import { statSync, constants, type Stats } from 'fs'
import { ipcMain } from 'electron'
import { isFile as commonIsFile, isDirectory as commonIsDirectory } from 'common/filesystem'
import { assertPathInScope, PathScopeError } from '../security/pathScope'

interface SerializedStat {
  size: number
  mtimeMs: number
  ctimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

export const registerFsHandlers = (): void => {
  // Read-only channels — intentionally NOT scope-checked (see pathScope.ts).
  ipcMain.handle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  ipcMain.handle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  ipcMain.handle('mt::fs::stat', async(_e, p: string) => serializeStat(await fs.stat(p)))
  ipcMain.handle('mt::fs::read-file', async(_e, p: string, encoding?: BufferEncoding) => {
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('mt::fs::readdir', (_e, p: string) => fs.readdir(p))

  // Mutating channels — every path must resolve inside an allowed root.
  ipcMain.handle('mt::fs::empty-dir', async(_e, p: string) => {
    await assertPathInScope(p)
    return fs.emptyDir(p)
  })
  ipcMain.handle('mt::fs::copy', async(_e, src: string, dest: string) => {
    await assertPathInScope(src)
    await assertPathInScope(dest)
    return fs.copy(src, dest)
  })
  ipcMain.handle('mt::fs::ensure-dir', async(_e, p: string) => {
    await assertPathInScope(p)
    return fs.ensureDir(p)
  })

  ipcMain.handle('mt::fs::output-file', async(_e, p: string, data: unknown) => {
    await assertPathInScope(p)
    return fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::move', async(_e, src: string, dest: string) => {
    await assertPathInScope(src)
    await assertPathInScope(dest)
    return fs.move(src, dest, { overwrite: false })
  })

  ipcMain.handle('mt::fs::write-file', async(_e, p: string, data: unknown) => {
    await assertPathInScope(p)
    return fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::unlink', async(_e, p: string) => {
    await assertPathInScope(p)
    return fs.unlink(p)
  })
  ipcMain.handle('mt::fs::is-executable', (_e, p: string) => {
    try {
      const stat = statSync(p)
      if (process.platform === 'win32') return stat.isFile()
      return (
        stat.isFile() &&
        (stat.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH)) !== 0
      )
    } catch {
      return false
    }
  })
}

// Re-export so callers (e.g. e2e specs) can match on the error type.
export { PathScopeError }
