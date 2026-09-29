import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// #26 item 3. The recents list used to be written with a bare
// `fs.writeFileSync` inside the `menu-add-recently-used` handler, and that
// handler runs *inside* `writeMarkdownFile(...).then(...)`
// (`main/menu/actions/file.ts:306`). A throw there is not "the recents menu did
// not update": it rejects the derived promise, lands in the save's `.catch`, and
// the renderer is told `mt::tab-save-failure` for a file that is already on
// disk -- and on save-as the `mt::set-pathname` that follows never runs, so the
// tab keeps the old name. The read side of the same file already swallows
// errors; this makes the write side match it.

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

import log from 'electron-log'
import { writeRecentlyUsedDocuments } from '../../../src/main/utils/recentDocuments'

const errors = vi.mocked(log.error)
let dir: string
let recents: string

beforeAll(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'colamd-recents-'))
  recents = path.join(dir, 'recently-used-documents.json')
})

afterEach(() => {
  // A read-only target has to be released before the next case can overwrite it.
  try {
    fs.chmodSync(recents, 0o644)
  } catch {
    // Not there (yet) -- nothing to release.
  }
  errors.mockClear()
})

describe('writeRecentlyUsedDocuments', () => {
  it('writes the list and reports success', () => {
    const target = path.join(dir, 'plain.json')
    expect(writeRecentlyUsedDocuments(target, ['/a.md', '/b.md'])).toBe(true)
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(['/a.md', '/b.md'])
  })

  it('creates the parent directory it needs', () => {
    const target = path.join(dir, 'nested', 'deeper', 'recently-used-documents.json')
    expect(writeRecentlyUsedDocuments(target, ['/a.md'])).toBe(true)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('reports failure instead of throwing when the file cannot be written', () => {
    fs.writeFileSync(recents, '[]', 'utf-8')
    fs.chmodSync(recents, 0o444)

    expect(() => writeRecentlyUsedDocuments(recents, ['/a.md'])).not.toThrow()
    expect(writeRecentlyUsedDocuments(recents, ['/a.md'])).toBe(false)
    // The failure is not silent: the caller continues, but the log says why.
    expect(errors).toHaveBeenCalled()
    expect(fs.readFileSync(recents, 'utf-8')).toBe('[]')
  })

  it('reports failure when the path is a directory', () => {
    const asDir = path.join(dir, 'a-directory.json')
    fs.mkdirSync(asDir, { recursive: true })

    expect(() => writeRecentlyUsedDocuments(asDir, ['/a.md'])).not.toThrow()
    expect(writeRecentlyUsedDocuments(asDir, ['/a.md'])).toBe(false)
    expect(errors).toHaveBeenCalled()
  })
})
