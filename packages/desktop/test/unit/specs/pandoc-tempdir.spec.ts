import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// `exportViaPandoc` writes the markdown into a fresh `colamd-pandoc-*` temp dir
// and sweeps it in a `finally`. The sweep used `unlink`, which cannot remove a
// directory on any platform -- so the error was swallowed and every export left
// a directory behind permanently. These tests hold both exit paths to "leaves
// nothing in the temp dir", which is the whole contract; pandoc itself is not
// needed because the child process is faked.

const h = vi.hoisted(() => ({ exitCode: 0 }))

vi.mock('child_process', () => {
  const spawn = (): EventEmitter => {
    const proc = new EventEmitter()
    queueMicrotask(() => proc.emit('close', h.exitCode))
    return proc
  }
  // `command-exists`, imported by the same module, reaches for the default
  // export of `child_process`, so the fake has to carry both shapes.
  return { spawn, default: { spawn } }
})

const prefix = 'colamd-pandoc-'
const leakedDirs = (): string[] => readdirSync(tmpdir()).filter((n) => n.startsWith(prefix))

async function runExport(wantFailure: boolean): Promise<void> {
  const { exportViaPandoc } = await import('main_renderer/utils/pandoc')
  const workDir = mkdtempSync(path.join(tmpdir(), 'pandoc-leak-spec-'))
  const before = leakedDirs().length
  const call = exportViaPandoc('# Doc\n', 'latex', path.join(workDir, 'out.tex'))
  if (wantFailure) {
    await expect(call).rejects.toThrow(/pandoc exited with code 2/)
  } else {
    await expect(call).resolves.toBeUndefined()
  }
  expect(leakedDirs().length).toBe(before)
}

describe('pandoc export temp directory', () => {
  it('removes its temp dir when the converter succeeds', async () => {
    h.exitCode = 0
    await runExport(false)
  })

  it('removes its temp dir when the converter fails, and still rejects', async () => {
    h.exitCode = 2
    await runExport(true)
  })
})
