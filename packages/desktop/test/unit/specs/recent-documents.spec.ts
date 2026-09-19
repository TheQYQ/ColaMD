import { describe, expect, it, vi } from 'vitest'
import {
  MAX_RECENTLY_USED_DOCUMENTS,
  readRecentlyUsedDocuments
} from '../../../src/main/utils/recentDocuments'

// The recently-used list is read by two entry points (the native/AppMenu recent
// submenu and the `mt::menu::get-recent-documents` IPC), which each grew their
// own copy of "parse, drop paths that no longer exist, cap at 12". These are the
// semantics both copies must keep while they share one implementation.

const RECENTS = '/userData/recently-used-documents.json'

const state = vi.hoisted(() => ({ existing: new Set<string>(), raw: '[]', throws: false }))

vi.mock('common/filesystem', () => ({
  isFile2: (p: string) => state.existing.has(p),
  isDirectory2: (p: string) => state.existing.has(p),
  ensureDirSync: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: () => {
      if (state.throws) throw new Error('unreadable')
      return state.raw
    }
  }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn() } }))

const withRecents = (entries: string[]): void => {
  state.raw = JSON.stringify(entries)
  state.existing = new Set([RECENTS, ...entries])
}

describe('recently used documents reader', () => {
  it('returns nothing when the recents file is absent', () => {
    state.existing = new Set()
    state.throws = false
    expect(readRecentlyUsedDocuments(RECENTS)).toEqual([])
  })

  it('drops entries that no longer exist on disk', () => {
    state.throws = false
    withRecents(['/docs/a.md', '/docs/gone.md', '/docs/b.md'])
    state.existing.delete('/docs/gone.md')

    expect(readRecentlyUsedDocuments(RECENTS)).toEqual(['/docs/a.md', '/docs/b.md'])
  })

  it('caps the list at the declared maximum', () => {
    state.throws = false
    const many = Array.from({ length: MAX_RECENTLY_USED_DOCUMENTS + 3 }, (_, i) => `/docs/f${i}.md`)
    withRecents(many)

    const result = readRecentlyUsedDocuments(RECENTS)
    expect(result).toHaveLength(MAX_RECENTLY_USED_DOCUMENTS)
    expect(result[0]).toBe('/docs/f0.md')
    expect(result[MAX_RECENTLY_USED_DOCUMENTS - 1]).toBe(
      `/docs/f${MAX_RECENTLY_USED_DOCUMENTS - 1}.md`
    )
  })

  it('returns nothing when the file cannot be parsed or read', () => {
    state.existing = new Set([RECENTS])
    state.raw = 'not json'
    expect(readRecentlyUsedDocuments(RECENTS)).toEqual([])

    state.throws = true
    expect(readRecentlyUsedDocuments(RECENTS)).toEqual([])
    state.throws = false
  })
})
