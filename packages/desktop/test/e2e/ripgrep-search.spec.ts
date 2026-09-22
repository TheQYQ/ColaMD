import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

// End-to-end smoke for the streaming ripgrep IPC (mt::rg::start /
// mt::rg::match / mt::rg::done). Writes a small fixture tree, drives the
// search directly through window.ripgrep so we don't depend on the sidebar
// being open + focused, and asserts results stream back to the renderer.

const writeFixtureTree = (): string => {
  const dir = path.join(os.tmpdir(), 'mt-rg-' + Math.random().toString(36).slice(2, 8))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'one.md'), '# Hello\n\nmagic-needle-XYZ in body.\n')
  fs.writeFileSync(path.join(dir, 'two.md'), '# Other\n\nnothing here.\n')
  fs.writeFileSync(path.join(dir, 'three.md'), '# Third\nanother magic-needle-XYZ.\n')
  return dir
}

test.describe('Ripgrep IPC streaming', () => {
  let app: ElectronApplication
  let page: Page
  let fixtureDir: string | null = null

  test.beforeAll(async () => {
    fixtureDir = writeFixtureTree()
    // The fixture is passed as an opened path so main registers it as an
    // allowed root — which is what a real search scope always is: quick-open
    // only ever searches folders the user opened. `mt::rg::start` rejects
    // directories outside that scope (see the case below), so a test that
    // searched an unopened temp dir would be driving the compromised-renderer
    // shape by accident.
    const launched = await launchElectron([fixtureDir])
    app = launched.app
    page = launched.page
  })

  test.afterAll(async () => {
    if (app) await app.close().catch(() => {})
    if (fixtureDir) {
      try {
        fs.rmSync(fixtureDir, { recursive: true, force: true })
      } catch {}
    }
  })

  // O7②: `mt::rg::start` answers with file contents and paths, recursively, so
  // the directories it searches are held to the same scope as mt::fs::read-file
  // and readdir. This is the case that fails open if the check is removed.
  test('a search over a directory outside every granted root is rejected', async () => {
    const other = path.join(os.tmpdir(), 'mt-rg-outside-' + Math.random().toString(36).slice(2, 8))
    fs.mkdirSync(other, { recursive: true })
    fs.writeFileSync(path.join(other, 'secret.md'), 'magic-needle-XYZ\n')

    try {
      await expect(
        page.evaluate((directory) => {
          return window.ripgrep.start({
            searchId: 'rg-outside',
            mode: 'files',
            directories: [directory],
            pattern: '',
            options: {}
          })
        }, other)
      ).rejects.toThrow(/outside the allowed scope/)
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  test('text search streams matches and resolves', async () => {
    interface RgMatch {
      filePath: string
    }
    const matches = await page.evaluate<RgMatch[], string>((directory) => {
      return new Promise<RgMatch[]>((resolve, reject) => {
        const searchId = 'rg-test-' + Math.random().toString(36).slice(2, 8)
        const captured: RgMatch[] = []
        const offMatch = window.ripgrep.onMatch((raw) => {
          const p = raw as { searchId?: string; payload?: RgMatch }
          if (p?.searchId === searchId && p.payload) captured.push(p.payload)
        })
        const cleanup = () => offMatch()
        const offDone = window.ripgrep.onDone((raw) => {
          const p = raw as { searchId?: string }
          if (p?.searchId !== searchId) return
          cleanup()
          offDone()
          offError()
          resolve(captured)
        })
        const offError = window.ripgrep.onError((raw) => {
          const p = raw as { searchId?: string; error?: string }
          if (p?.searchId !== searchId) return
          cleanup()
          offDone()
          offError()
          reject(new Error(p.error))
        })
        window.ripgrep
          .start({
            searchId,
            mode: 'text',
            directories: [directory],
            pattern: 'magic-needle-XYZ',
            options: { isCaseSensitive: true, inclusions: ['*.md'], exclusions: [] }
          })
          .catch(reject)
      })
    }, fixtureDir as string)

    expect(matches.length).toBeGreaterThanOrEqual(2)
    const paths = matches.map((m) => m.filePath).sort()
    expect(paths.some((p) => p.endsWith('one.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('three.md'))).toBe(true)
  })

  test('file search (--files) streams paths', async () => {
    const files = await page.evaluate<string[], string>((directory) => {
      return new Promise<string[]>((resolve, reject) => {
        const searchId = 'fs-test-' + Math.random().toString(36).slice(2, 8)
        const seen: string[] = []
        const offMatch = window.ripgrep.onMatch((raw) => {
          const p = raw as { searchId?: string; payload?: unknown }
          if (p?.searchId === searchId && typeof p.payload === 'string') seen.push(p.payload)
        })
        const offDone = window.ripgrep.onDone((raw) => {
          const p = raw as { searchId?: string }
          if (p?.searchId !== searchId) return
          offMatch()
          offDone()
          offError()
          resolve(seen)
        })
        const offError = window.ripgrep.onError((raw) => {
          const p = raw as { searchId?: string; error?: string }
          if (p?.searchId !== searchId) return
          offMatch()
          offDone()
          offError()
          reject(new Error(p.error))
        })
        window.ripgrep
          .start({
            searchId,
            mode: 'files',
            directories: [directory],
            pattern: '',
            options: { inclusions: ['*.md'], exclusions: [] }
          })
          .catch(reject)
      })
    }, fixtureDir as string)

    expect(files.length).toBeGreaterThanOrEqual(3)
  })
})
