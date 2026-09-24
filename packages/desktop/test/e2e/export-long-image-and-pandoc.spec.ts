import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { spawnSync } from 'node:child_process'
import { launchWithMarkdown, waitForMenuReady } from './helpers'
import { installExportSuccessProbe, restoreSaveDialog, runExport } from './exportHarness'

// The two export paths that used to end in "needs a real machine to check":
// the long image (File › Export › Image) and the pandoc-converted formats.
// Both are wired through the same seam as PDF — the menu command, the export
// dialog, main's writer — so they need no plumbing of their own, and what they
// produce can be read off the file: an image that is taller than it is wide
// (a viewport screenshot would not be), and a container each format signs with.

const LONG_DOC =
  '# Walkthrough\n\n' +
  'A paragraph with **bold** and *italic*.\n\n' +
  '## Section\n\n' +
  '- one\n- two\n\n' +
  '```js\nconst a = 1\n```\n\n' +
  '| h1 | h2 |\n| --- | --- |\n| a | b |\n\n' +
  // Enough body text that a clipped capture cannot pass for a long image.
  'Body paragraph that adds height to the exported image.\n\n'.repeat(90)

const pngDimensions = (data: Buffer): { width: number; height: number } => ({
  width: data.readUInt32BE(16),
  height: data.readUInt32BE(20)
})

const hasPandoc = (): boolean =>
  spawnSync('pandoc', ['--version'], { encoding: 'utf8' }).status === 0

test.describe('Long image and pandoc exports (roadmap §7 walkthrough)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown(LONG_DOC)
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    await installExportSuccessProbe(page)
  })

  test.afterAll(async () => {
    if (app) {
      await restoreSaveDialog(app)
      await app.close()
    }
  })

  const stamp = Date.now()
  const target = (ext: string): string => `/tmp/colamd-export-${stamp}.${ext}`

  test('Image (PNG) exports the whole document, not the first screen', async () => {
    test.setTimeout(120_000)
    const file = target('png')

    const { bytes, success } = await runExport(app, page, 'png', file)

    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47')
    const { width, height } = pngDimensions(bytes)
    expect(width).toBeGreaterThanOrEqual(800)
    expect(height).toBeGreaterThan(width)
    expect(success?.type).toBe('png')
  })

  test('Image (JPEG) exports too', async () => {
    test.setTimeout(120_000)
    const file = target('jpg')

    const { bytes, success } = await runExport(app, page, 'jpeg', file)

    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(success?.type).toBe('jpeg')
  })

  for (const [type, ext, sign] of [
    ['epub', 'epub', (b: Buffer) => expect(b.subarray(0, 2).toString('latin1')).toBe('PK')],
    ['latex', 'tex', (b: Buffer) => expect(b.toString('utf8')).toContain('\\begin{document}')],
    ['rtf', 'rtf', (b: Buffer) => expect(b.subarray(0, 5).toString('latin1')).toBe('{\\rtf')],
    ['opml', 'opml', (b: Buffer) => expect(b.toString('utf8')).toContain('<opml')]
  ] as const) {
    test(`pandoc ${type} converts for real`, async () => {
      test.skip(!hasPandoc(), 'pandoc is not installed')
      test.setTimeout(120_000)
      const file = target(ext)

      const { bytes, success } = await runExport(app, page, type, file, 60_000)

      sign(bytes)
      expect(success?.type).toBe(type)
    })
  }
})
