import { describe, expect, it, vi } from 'vitest'

// Mirror watcher-await-write-finish.spec.ts: pull in the real module without
// loading Electron-native paths (ced bindings are Electron-ABI only).
vi.mock('chokidar', () => ({
  default: {
    watch: () => ({
      on: vi.fn(),
      close: vi.fn(() => Promise.resolve())
    })
  }
}))
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

import { shouldIgnoreTreePath } from 'main_renderer/filesystem/watcher'

const asFile = { isDirectory: () => false }
const asDir = { isDirectory: () => true }

const basePrefs = {
  treePathExcludePatterns: [] as string[],
  treeShowNonMarkdownFiles: false,
  treeShowHiddenFiles: false
}

describe('shouldIgnoreTreePath', () => {
  it('always ignores node_modules and asar files', () => {
    expect(shouldIgnoreTreePath('/repo/node_modules/foo', asDir, basePrefs)).toBe(true)
    expect(shouldIgnoreTreePath('/repo/app.asar', asFile, basePrefs)).toBe(true)
  })

  it('keeps directories when no other filter matches', () => {
    expect(shouldIgnoreTreePath('/repo/src', asDir, basePrefs)).toBe(false)
  })

  it('defaults to markdown-only files', () => {
    expect(shouldIgnoreTreePath('/repo/notes.md', asFile, basePrefs)).toBe(false)
    expect(shouldIgnoreTreePath('/repo/notes.txt', asFile, basePrefs)).toBe(false)
    expect(shouldIgnoreTreePath('/repo/notes.json', asFile, basePrefs)).toBe(true)
  })

  it('lists non-markdown files when the preference is on', () => {
    const prefs = { ...basePrefs, treeShowNonMarkdownFiles: true }
    expect(shouldIgnoreTreePath('/repo/notes.json', asFile, prefs)).toBe(false)
  })

  it('hides dot files and directories by default', () => {
    expect(shouldIgnoreTreePath('/repo/.git', asDir, basePrefs)).toBe(true)
    expect(shouldIgnoreTreePath('/repo/.env', asFile, basePrefs)).toBe(true)
    expect(shouldIgnoreTreePath('/repo/notes.md', asFile, basePrefs)).toBe(false)
  })

  it('shows hidden paths when the preference is on', () => {
    const prefs = { ...basePrefs, treeShowHiddenFiles: true }
    expect(shouldIgnoreTreePath('/repo/.git', asDir, prefs)).toBe(false)
    expect(shouldIgnoreTreePath('/repo/.hidden.md', asFile, prefs)).toBe(false)
  })

  it('applies custom exclude patterns', () => {
    const prefs = { ...basePrefs, treePathExcludePatterns: ['**/drafts/**'] }
    expect(shouldIgnoreTreePath('/repo/drafts/notes.md', asFile, prefs)).toBe(true)
    expect(shouldIgnoreTreePath('/repo/public/notes.md', asFile, prefs)).toBe(false)
  })

  it('does not apply tree visibility filters to single-file watchers', () => {
    // Open `.notes.md` must stay watched even with hidden files off.
    expect(shouldIgnoreTreePath('/repo/.notes.md', asFile, basePrefs, 'file')).toBe(false)
    expect(shouldIgnoreTreePath('/repo/notes.txt', asFile, basePrefs, 'file')).toBe(false)
  })
})
