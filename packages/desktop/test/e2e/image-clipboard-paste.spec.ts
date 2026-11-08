import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp, getMarkdownContent, launchWithMarkdown, placeCaretInEditor } from './helpers'

// Pasting a clipboard BITMAP (a screenshot tool's "copy image") into the
// editor used to leave ONE LINE OF BASE64 GARBAGE in the document.
//
// The chain: the engine reads the clipboard's `image/png` file, turns it into a
// `data:` URL, and calls the embedder's `imageAction` hook with the state
// object `{ src, alt, title }` (the `IMuyaOptions.imageAction` contract).
// The desktop had wired its OWN callback — the `(image, id, alt)` shape — into
// that slot, so the state object arrived where a path string was expected:
// the base64 payload was written into the document verbatim, and the follow-up
// `file.arrayBuffer()` threw, leaving the placeholder line behind.
//
// This spec drives the REAL built Electron app with a real PNG on the system
// clipboard and asserts the document ends up with an IMAGE REFERENCE — not an
// inline base64 blob, and no `loading-*` placeholder left over.

const PNG_PATH = path.resolve(__dirname, '../../static/logo-96px.png')

test.describe('pasting a clipboard bitmap inserts an image reference', () => {
  let app: ElectronApplication | null = null
  let page: Page
  let markdown: string

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('hello\n')
    app = launched.app
    page = launched.page

    // A real PNG on the system clipboard — the shape a screenshot tool writes.
    const png = fs.readFileSync(PNG_PATH)
    await app.evaluate(({ clipboard, nativeImage }, buf) => {
      const img = nativeImage.createFromBuffer(Buffer.from(buf, 'base64'))
      clipboard.writeImage(img)
    }, png.toString('base64'))

    await placeCaretInEditor(page)

    // Paste exactly the way the Edit menu does it.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.paste()
    })

    await page.waitForTimeout(1500)
    markdown = await getMarkdownContent(page, app)
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('the document holds an image reference, not an inline base64 blob', () => {
    expect(markdown).toContain('![')
    // The base64 payload must NOT be in the document.
    expect(markdown).not.toContain('base64,')
    expect(markdown).not.toContain('data:image/')
  })

  test('no placeholder is left behind', () => {
    // The `loading-<id>` alt is the engine's in-flight marker: it is replaced
    // once `imageAction` resolves. A leftover means the persist step failed.
    expect(markdown).not.toContain('loading-')
  })

  test('the image was persisted to a real file', async () => {
    // The reference points at a file on disk (the copy-to-assets folder), not
    // at an inline payload.
    const src = /!\[[^\]]*\]\(([^)]+)\)/.exec(markdown)?.[1]
    expect(src).toBeTruthy()
    expect(src).not.toMatch(/^data:/)
    expect(fs.existsSync(src as string)).toBe(true)
  })
})
