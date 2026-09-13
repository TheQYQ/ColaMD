import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportViaPandoc } from '../../../src/main/utils/pandoc'

// The pandoc export path (Typora parity: EPUB / LaTeX / RTF / OPML) writes the
// markdown to a temp file and lets pandoc write the output file itself with
// `-o` — binary formats (EPUB = ZIP) must never travel through stdout strings.

vi.mock('child_process', () => {
  const spawn = vi.fn()
  return { default: { spawn }, spawn }
})

const mockedSpawn = vi.mocked(spawn)

// Wire a fresh proc per spawn() call so the `close` event is scheduled at
// invocation time — exportViaPandoc attaches its listeners synchronously right
// after spawn() returns, so a setImmediate emit lands on live listeners.
const mockPandoc = (behavior: { exitCode?: number; stderr?: string } = {}) => {
  mockedSpawn.mockImplementation((() => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    proc.stderr = new EventEmitter()
    setImmediate(() => {
      const { exitCode = 0, stderr = '' } = behavior
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
      proc.emit('close', exitCode)
    })
    return proc
    // The real signature returns ChildProcess; the fake proc only needs the
    // EventEmitter surface exportViaPandoc touches.
  }) as unknown as typeof spawn)
}

beforeEach(() => {
  mockedSpawn.mockReset()
})

describe('exportViaPandoc', () => {
  it('spawns pandoc with markdown source, target format and -o output', async() => {
    mockPandoc()

    await exportViaPandoc('# T\n\ntext\n', 'epub', 'C:/out/document.epub')

    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    const [command, args] = mockedSpawn.mock.calls[0] as unknown as [string, string[]]
    expect(command).toBe('pandoc')
    expect(args.slice(0, 6)).toEqual(['-f', 'markdown', '-t', 'epub', '-o', 'C:/out/document.epub'])
    // The last argument is the temp markdown file, cleaned up afterwards.
    const tmpMarkdown = args.at(-1) as string
    expect(tmpMarkdown.endsWith('.md')).toBe(true)
    expect(existsSync(tmpMarkdown)).toBe(false)
  })

  it('passes the document title as pandoc metadata', async() => {
    mockPandoc()

    await exportViaPandoc('body', 'epub', 'C:/out/doc.epub', { title: 'My Book' })

    const [, args] = mockedSpawn.mock.calls[0] as unknown as [string, string[]]
    expect(args).toContain('--metadata')
    expect(args).toContain('title:My Book')
  })

  it('omits the metadata flag when no title is given', async() => {
    mockPandoc()

    await exportViaPandoc('body', 'latex', 'C:/out/doc.tex')

    const [, args] = mockedSpawn.mock.calls[0] as unknown as [string, string[]]
    expect(args).not.toContain('--metadata')
  })

  it('rejects with pandoc stderr when the conversion fails', async() => {
    mockPandoc({ exitCode: 1, stderr: 'bad markdown' })

    await expect(
      exportViaPandoc('body', 'rtf', 'C:/out/doc.rtf')
    ).rejects.toThrow('bad markdown')

    // Temp file is cleaned up even on failure.
    const [, args] = mockedSpawn.mock.calls[0] as unknown as [string, string[]]
    expect(existsSync(args.at(-1) as string)).toBe(false)
  })

  it('falls back to the exit-code message when stderr is empty', async() => {
    mockPandoc({ exitCode: 2 })

    await expect(
      exportViaPandoc('body', 'opml', 'C:/out/doc.opml')
    ).rejects.toThrow('pandoc exited with code 2')
  })
})
