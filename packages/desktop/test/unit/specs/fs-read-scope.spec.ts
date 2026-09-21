import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'

// O7② — the two channels that disclose contents and names go through the path
// scope now; the boolean probes deliberately do not, so both halves are pinned
// here: an out-of-scope read must fail, and `path-exists` on the same path must
// keep answering (that is the decision, and it should not break silently).

const { handleChannels } = vi.hoisted(() => ({
  handleChannels: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handleChannels.set(channel, listener)
    }
  }
}))

import { registerFsHandlers } from '../../../src/main/ipc/fs'
import { addAllowedRoot, clearAllowedRootsForTest } from '../../../src/main/security/pathScope'

registerFsHandlers()

const call = async(channel: string, ...args: unknown[]): Promise<unknown> => {
  const listener = handleChannels.get(channel)
  if (!listener) throw new Error(`nothing listens on ${channel}`)
  return listener({ sender: {} }, ...args)
}

let root: string
let outside: string

beforeAll(async() => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'colamd-scope-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'colamd-outside-'))
  await fs.writeFile(path.join(root, 'note.md'), '# hello\n')
  await fs.writeFile(path.join(outside, 'secret.md'), 'do not read me\n')
  clearAllowedRootsForTest()
  addAllowedRoot(root)
})

afterAll(async() => {
  clearAllowedRootsForTest()
  await fs.remove(root)
  await fs.remove(outside)
})

describe('read disclosure is scoped', () => {
  it('reads a file inside a granted root', async() => {
    const buf = (await call('mt::fs::read-file', path.join(root, 'note.md'))) as Buffer
    expect(buf.toString()).toBe('# hello\n')
  })

  it('lists a granted root', async() => {
    expect(await call('mt::fs::readdir', root)).toEqual(['note.md'])
  })

  it('refuses to read a file outside every root', async() => {
    await expect(call('mt::fs::read-file', path.join(outside, 'secret.md'))).rejects.toThrow(
      /outside the allowed scope/
    )
  })

  it('refuses to list a directory outside every root', async() => {
    await expect(call('mt::fs::readdir', outside)).rejects.toThrow(/outside the allowed scope/)
  })

  // The deliberate part: the probes still answer about the same ungranted path.
  it('still answers the boolean probes, which is the recorded boundary', async() => {
    expect(await call('mt::fs::path-exists', path.join(outside, 'secret.md'))).toBe(true)
    expect(await call('mt::fs::is-file', path.join(outside, 'secret.md'))).toBe(true)
  })
})
