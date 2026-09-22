import fs from 'fs-extra'
import { statSync, constants } from 'fs'
import { typedHandle } from './typedHandle'
import { isFile as commonIsFile, isDirectory as commonIsDirectory } from 'common/filesystem'
import { assertPathInScope } from '../security/pathScope'

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
  // Content and name disclosure — scope-checked, because these are the two that
  // can exfiltrate what a file contains or what a directory holds. Every caller
  // already reads inside a granted root: the two settings/PDF paths read
  // `<userData>/themes/export` (registered at app/index.ts:273), and theme import
  // reads a path the user just picked, which `mt::dialog::open` grants.
  typedHandle('mt::fs::read-file', async (_e, p: string, encoding?: BufferEncoding) => {
    await assertPathInScope(p)
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  typedHandle('mt::fs::readdir', async (_e, p: string) => {
    await assertPathInScope(p)
    return fs.readdir(p)
  })

  // Existence and mode probes — deliberately NOT scope-checked, and this is the
  // line, not an oversight. They answer one bit about a path the caller already
  // claims, never its contents or siblings, and their callers need to ask about
  // paths that are outside every root by design: the uploader row checks whether
  // the script the user just chose is executable, and the tab/project code probes
  // candidate directories before anything is granted. Tightening them is a
  // separate decision with a grant story per caller (docs/OPTIMIZATION_ROADMAP.md
  // O7② "剩下的").
  typedHandle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  typedHandle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  typedHandle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))

  // Mutating channels — every path must resolve inside an allowed root.
  typedHandle('mt::fs::copy', async (_e, src: string, dest: string) => {
    await assertPathInScope(src)
    await assertPathInScope(dest)
    return fs.copy(src, dest)
  })
  typedHandle('mt::fs::ensure-dir', async (_e, p: string) => {
    await assertPathInScope(p)
    return fs.ensureDir(p)
  })

  typedHandle('mt::fs::output-file', async (_e, p: string, data: unknown) => {
    await assertPathInScope(p)
    return fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  typedHandle('mt::fs::move', async (_e, src: string, dest: string) => {
    await assertPathInScope(src)
    await assertPathInScope(dest)
    return fs.move(src, dest, { overwrite: false })
  })

  typedHandle('mt::fs::write-file', async (_e, p: string, data: unknown) => {
    await assertPathInScope(p)
    return fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  typedHandle('mt::fs::unlink', async (_e, p: string) => {
    await assertPathInScope(p)
    return fs.unlink(p)
  })
  typedHandle('mt::fs::is-executable', (_e, p: string) => {
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
