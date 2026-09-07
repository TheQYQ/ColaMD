import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { launchElectron, waitForEditor, waitForMenuReady } from './helpers'

// These specs exercise the path-scope enforcement that guards the renderer-facing
// mutating IPC channels. A compromised renderer (the threat model) must NOT be
// able to write/delete/trash files outside directories the user explicitly
// granted via trusted flows (dialog / argv / file tree of an opened root).

const writeTempMarkdown = (markdown = '# hello\n'): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sec-'))
  const file = path.join(dir, 'doc.md')
  fs.writeFileSync(file, markdown)
  return file
}

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sec-other-'))

test.describe('Path scope enforcement (M2 security package)', () => {
  let app: ElectronApplication
  let page: Page
  // The directory that the e2e harness opens via argv — this is the one allowed
  // root (granted by _openPathList for the file's dirname).
  let docDir: string
  let docFile: string

  test.beforeAll(async() => {
    docFile = writeTempMarkdown('# scope test\n')
    docDir = path.dirname(docFile)
    const { app: a, page: p } = await launchElectron([docFile])
    app = a
    page = p
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('write-file INSIDE the allowed root succeeds', async() => {
    const target = path.join(docDir, 'in-scope.md')
    const result = await page.evaluate(
      ([p, data]) => window.fileUtils.writeFile(p, data) as Promise<void>,
      [target, 'allowed write']
    )
    expect(result).toBeUndefined()
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe('allowed write')
  })

  test('write-file OUTSIDE the allowed root is rejected', async() => {
    const otherDir = makeTempDir()
    const target = path.join(otherDir, 'out-of-scope.md')
    await expect(
      page.evaluate(
        ([p, data]) => window.fileUtils.writeFile(p, data) as Promise<void>,
        [target, 'should not land']
      )
    ).rejects.toThrow()
    expect(fs.existsSync(target)).toBe(false)
  })

  test('output-file OUTSIDE the allowed root is rejected', async() => {
    const otherDir = makeTempDir()
    const target = path.join(otherDir, 'nested', 'out.md')
    await expect(
      page.evaluate(
        ([p, data]) => window.fileUtils.outputFile(p, data) as Promise<void>,
        [target, 'nope']
      )
    ).rejects.toThrow()
    expect(fs.existsSync(target)).toBe(false)
  })

  test('move with destination OUTSIDE the allowed root is rejected', async() => {
    // Create a file inside the allowed root, then try to move it elsewhere.
    const otherDir = makeTempDir()
    const src = path.join(docDir, 'move-src.md')
    fs.writeFileSync(src, 'move me')
    const dest = path.join(otherDir, 'move-dest.md')

    await expect(
      page.evaluate(([s, d]) => window.fileUtils.move(s, d) as Promise<void>, [src, dest])
    ).rejects.toThrow()
    // Source must be untouched on failure.
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.existsSync(dest)).toBe(false)
  })

  test('trash-item OUTSIDE the allowed root is rejected', async() => {
    // Create a throwaway file outside the root and confirm the renderer cannot
    // trash it (the call must reject, and the file must survive).
    const otherDir = makeTempDir()
    const target = path.join(otherDir, 'keep-me.md')
    fs.writeFileSync(target, 'do not trash')

    await expect(
      page.evaluate(
        (p) => window.electron.ipcRenderer.invoke('mt::fs-trash-item', p) as Promise<void>,
        target
      )
    ).rejects.toThrow()
    expect(fs.existsSync(target)).toBe(true)
  })

  test('open-path OUTSIDE the allowed root is rejected', async() => {
    // openPath on an executable would launch it — effectively exec. Even for a
    // non-executable, an out-of-scope openPath must be blocked.
    const otherDir = makeTempDir()
    const target = path.join(otherDir, 'nope.txt')
    fs.writeFileSync(target, 'x')

    const result = await page.evaluate(
      (p) => window.electron.shell.openPath(p) as Promise<string>,
      target
    )
    // On violation the handler resolves with the error message string rather
    // than throwing; the message must indicate the scope block.
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
