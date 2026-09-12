import { describe, it, expect } from 'vitest'
import { resolveCleanupCandidate, isImageUnreferenced } from '@/util/imageCleanup'
import pathe from 'pathe'

// IMG.2 — pure guards for the unreferenced-image cleanup: the path domain
// (document folder / image folder only) and the no-reference check. The
// `window.path` surface is pathe-based in production, so tests drive the same
// library through the same call shapes.

const pathDeps = {
  path: pathe,
  isChildOfDirectory: (dir: string, child: string): boolean => {
    if (!dir || !child) return false
    const relative = pathe.relative(dir, child)
    return !!relative && !relative.startsWith('..') && !pathe.isAbsolute(relative)
  }
}

const DOC_DIR = 'C:/docs/notes'
const IMAGE_FOLDER = 'C:/pictures/md'

describe('resolveCleanupCandidate — path domain', () => {
  it('resolves a relative src against the document dir', () => {
    const candidate = resolveCleanupCandidate(
      './assets/logo-abc123.png',
      DOC_DIR,
      '',
      pathDeps
    )
    expect(candidate).toEqual({
      absolutePath: 'C:/docs/notes/assets/logo-abc123.png',
      rawSrc: './assets/logo-abc123.png'
    })
  })

  it('accepts absolute paths inside the document subtree', () => {
    const candidate = resolveCleanupCandidate('C:/docs/notes/img/x.png', DOC_DIR, '', pathDeps)
    expect(candidate?.absolutePath).toBe('C:/docs/notes/img/x.png')
  })

  it('accepts files inside the configured global image folder', () => {
    const candidate = resolveCleanupCandidate('C:/pictures/md/y.png', DOC_DIR, IMAGE_FOLDER, pathDeps)
    expect(candidate?.absolutePath).toBe('C:/pictures/md/y.png')
  })

  it('rejects files outside both roots (path domain guard)', () => {
    expect(resolveCleanupCandidate('C:/Windows/system32/evil.png', DOC_DIR, IMAGE_FOLDER, pathDeps)).toBeNull()
    expect(resolveCleanupCandidate('C:/docs/other-doc/x.png', DOC_DIR, '', pathDeps)).toBeNull()
  })

  it('rejects non-image extensions and remote/data sources', () => {
    expect(resolveCleanupCandidate('./notes.txt', DOC_DIR, '', pathDeps)).toBeNull()
    expect(resolveCleanupCandidate('https://example.com/a.png', DOC_DIR, '', pathDeps)).toBeNull()
    expect(resolveCleanupCandidate('data:image/png;base64,AAAA', DOC_DIR, '', pathDeps)).toBeNull()
    expect(resolveCleanupCandidate('', DOC_DIR, '', pathDeps)).toBeNull()
  })

  it('resolves file:// URLs', () => {
    const candidate = resolveCleanupCandidate('file:///C:/docs/notes/assets/a.png', DOC_DIR, '', pathDeps)
    expect(candidate?.absolutePath).toBe('C:/docs/notes/assets/a.png')
  })
})

describe('isImageUnreferenced', () => {
  const candidate = {
    absolutePath: 'C:/docs/notes/assets/logo-abc123.png',
    rawSrc: './assets/logo-abc123.png'
  }

  it('is referenced when some markdown mentions the raw src', () => {
    expect(isImageUnreferenced(['![x](./assets/logo-abc123.png)'], candidate)).toBe(false)
  })

  it('is referenced when some markdown mentions the absolute path', () => {
    expect(isImageUnreferenced(['![x](C:/docs/notes/assets/logo-abc123.png)'], candidate)).toBe(false)
  })

  it('is referenced by a different relative base naming the same file', () => {
    expect(isImageUnreferenced(['![x](../notes/assets/logo-abc123.png)'], candidate)).toBe(false)
  })

  it('is unreferenced when no markdown mentions it (undo did not restore it)', () => {
    expect(isImageUnreferenced(['no image here', ''], candidate)).toBe(true)
  })
})
