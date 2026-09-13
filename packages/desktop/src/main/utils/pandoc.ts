// Copy from https://github.com/utatti/simple-pandoc/blob/master/index.js
import { spawn } from 'child_process'
import { mkdtemp, unlink, writeFile as fsWriteFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { Readable } from 'stream'
import commandExists from 'command-exists'
import { isFile2 } from 'common/filesystem'

const pandocCommand = 'pandoc'

const getCommand = (): string => {
  if (envPathExists()) {
    return process.env.COLAMD_PANDOC as string
  }
  return pandocCommand
}

interface PandocConverter {
  (): Promise<string>
  stream: (srcStream: NodeJS.ReadableStream) => Readable | null
}

interface PandocFn {
  (from: string, to: string, ...args: string[]): PandocConverter
  exists: () => boolean
}

const pandoc = ((from: string, to: string, ...args: string[]): PandocConverter => {
  const command = getCommand()
  const option = ['-s', from, '-t', to].concat(args)

  const converter = ((): Promise<string> =>
    new Promise((resolve, reject) => {
      const proc = spawn(command, option)
      proc.on('error', reject)
      let data = ''
      proc.stdout.on('data', (chunk: Buffer | string) => {
        data += chunk.toString()
      })
      proc.stdout.on('end', () => resolve(data))
      proc.stdout.on('error', reject)
      proc.stdin.end()
    })) as PandocConverter

  converter.stream = (srcStream: NodeJS.ReadableStream): Readable | null => {
    const proc = spawn(command, option)
    srcStream.pipe(proc.stdin)
    return proc.stdout
  }

  return converter
}) as PandocFn

pandoc.exists = (): boolean => {
  if (envPathExists()) {
    return true
  }
  return commandExists.sync(pandocCommand)
}

const envPathExists = (): boolean => {
  return !!process.env.COLAMD_PANDOC && isFile2(process.env.COLAMD_PANDOC)
}

export default pandoc

// ---------------------------------------------------------------------------
// Markdown → file export (Typora parity: export via pandoc to EPUB / LaTeX /
// RTF / OPML). Writes output with `-o` so binary formats (EPUB is a ZIP) never
// travel through stdout string accumulation.
// ---------------------------------------------------------------------------

export interface IPandocExportOptions {
  /** Document title → pandoc `--metadata title=…` (EPUB metadata). */
  title?: string
  /** Extra pandoc CLI arguments (e.g. `--epub-chapter-level=1`). */
  args?: string[]
}

export async function exportViaPandoc(
  markdown: string,
  format: string,
  outputPath: string,
  options: IPandocExportOptions = {}
): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'colamd-pandoc-'))
  const tmpMarkdown = path.join(tmpDir, 'document.md')
  await fsWriteFile(tmpMarkdown, markdown, 'utf8')

  try {
    const command = getCommand()
    const args = [
      '-f', 'markdown',
      '-t', format,
      '-o', outputPath,
      ...(options.title ? ['--metadata', `title:${options.title}`] : []),
      ...(options.args ?? []),
      tmpMarkdown,
    ]

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(command, args)
      let stderr = ''
      proc.on('error', reject)
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
      })
      proc.on('close', (code) => {
        if (code === 0) { resolve() } else { reject(new Error(stderr.trim() || `pandoc exited with code ${code}`)) }
      })
    })
  } finally {
    await unlink(tmpMarkdown).catch(() => {})
    await unlink(tmpDir).catch(() => {})
  }
}
