import { lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { realpath } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Pure Node module — no electron import, runs in the unit (jsdom) environment.
const {
  addAllowedRoot,
  getAllowedRoots,
  assertPathInScope,
  clearAllowedRootsForTest,
  PathScopeError
} = await import('main_renderer/security/pathScope')

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'mt-scope-'))
  dirs.push(d)
  return d
}

// Mirror of pathScope.canonicalize for expectation building: resolve the longest
// existing prefix via realpath, re-append any non-existing tail.
function canonSync(p: string): string {
  const abs = path.resolve(p)
  const tail: string[] = []
  let cursor = abs
  for (;;) {
    try {
      const resolved = realpathSync(cursor)
      return tail.length ? path.join(resolved, ...tail.reverse()) : resolved
    } catch {
      const parent = path.dirname(cursor)
      if (parent === cursor) return abs
      tail.push(path.basename(cursor))
      cursor = parent
    }
  }
}

// symlinkSync can return *without* creating a link in sandboxes lacking the
// privilege, and jsdom shims the sync `fs` (so its virtual links are invisible
// to the source module, which imports `realpath` from `fs/promises`). Confirm
// the OS actually resolves the link to its *declared* target through the real
// async fs the source uses — otherwise the escape path can't be exercised and
// the test must be skipped.
async function trySymlink(target: string, link: string): Promise<boolean> {
  try {
    symlinkSync(target, link)
  } catch {
    return false
  }
  let isLink = false
  try {
    isLink = lstatSync(link).isSymbolicLink()
  } catch {
    return false
  }
  if (!isLink) return false
  try {
    const resolved = await realpath(link)
    const targetResolved = await realpath(target)
    return resolved === targetResolved
  } catch {
    return false
  }
}

beforeEach(clearAllowedRootsForTest)
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('assertPathInScope — input validation', () => {
  it('rejects non-string input', async () => {
    await expect(assertPathInScope(123 as unknown as string)).rejects.toBeInstanceOf(PathScopeError)
    await expect(assertPathInScope(null as unknown as string)).rejects.toBeInstanceOf(
      PathScopeError
    )
    await expect(assertPathInScope(undefined as unknown as string)).rejects.toBeInstanceOf(
      PathScopeError
    )
  })

  it('rejects empty string', async () => {
    await expect(assertPathInScope('')).rejects.toBeInstanceOf(PathScopeError)
  })

  it('rejects relative paths', async () => {
    addAllowedRoot(tempDir())
    await expect(assertPathInScope('foo/bar.md')).rejects.toBeInstanceOf(PathScopeError)
    await expect(assertPathInScope('./relative.md')).rejects.toBeInstanceOf(PathScopeError)
  })
})

describe('assertPathInScope — scope enforcement', () => {
  it('accepts a path that is exactly the allowed root', async () => {
    const root = tempDir()
    addAllowedRoot(root)
    await expect(assertPathInScope(root)).resolves.toBe(path.resolve(root))
  })

  it('accepts a nested subpath of the allowed root', async () => {
    const root = tempDir()
    addAllowedRoot(root)
    const nested = path.join(root, 'sub', 'dir', 'file.md')
    await expect(assertPathInScope(nested)).resolves.toBe(canonSync(nested))
  })

  it('rejects a path outside any allowed root', async () => {
    addAllowedRoot(tempDir())
    const other = tempDir()
    await expect(assertPathInScope(other)).rejects.toBeInstanceOf(PathScopeError)
  })

  it('rejects ".." escape attempts that leave the root', async () => {
    const root = tempDir()
    addAllowedRoot(root)
    const escape = path.join(root, '..', 'evil.md')
    await expect(assertPathInScope(escape)).rejects.toBeInstanceOf(PathScopeError)
  })

  it('rejects a sibling prefix (C:\\docs-evil must not match root C:\\docs)', async () => {
    const root = tempDir()
    // Fabricate a sibling by appending a suffix to the resolved root path.
    const sibling = root + '-evil'
    addAllowedRoot(root)
    await expect(assertPathInScope(sibling)).rejects.toBeInstanceOf(PathScopeError)
  })

  it('accepts a not-yet-existing target under an allowed root', async () => {
    const root = tempDir()
    addAllowedRoot(root)
    const future = path.join(root, 'new', 'file.md')
    await expect(assertPathInScope(future)).resolves.toBe(canonSync(future))
  })
})

describe('assertPathInScope — symlink resolution', () => {
  it('rejects a symlink inside the root that points outside it', async () => {
    const root = tempDir()
    const outside = tempDir()
    addAllowedRoot(root)

    // Target lives outside the allowed root; link lives inside it.
    const targetFile = path.join(outside, 'secret.md')
    writeFileSync(targetFile, 'secret')
    const linkFile = path.join(root, 'link.md')
    if (!(await trySymlink(targetFile, linkFile))) return

    await expect(assertPathInScope(linkFile)).rejects.toBeInstanceOf(PathScopeError)
  })

  it('accepts a symlink inside the root that points inside the root', async () => {
    const root = tempDir()
    addAllowedRoot(root)

    const realFile = path.join(root, 'real.md')
    writeFileSync(realFile, 'ok')
    const linkFile = path.join(root, 'link.md')
    if (!(await trySymlink(realFile, linkFile))) return

    await expect(assertPathInScope(linkFile)).resolves.toBe(canonSync(realFile))
  })
})

describe('assertPathInScope — case handling', () => {
  it('treats root and candidate case-insensitively on case-insensitive platforms', async () => {
    const root = tempDir()
    addAllowedRoot(root)

    const platform = process.platform
    const mixed = root.toUpperCase() === root ? root.toLowerCase() : root.toUpperCase()
    if (platform === 'win32' || platform === 'darwin') {
      // On case-insensitive FS, a differently-cased path must still match.
      await expect(assertPathInScope(mixed)).resolves.toBeDefined()
    } else {
      // On Linux (case-sensitive), a differently-cased path is a different path.
      await expect(assertPathInScope(mixed)).rejects.toBeInstanceOf(PathScopeError)
    }
  })
})

describe('addAllowedRoot / getAllowedRoots', () => {
  it('resolves and dedupes roots', () => {
    const root = tempDir()
    addAllowedRoot(root)
    addAllowedRoot(root) // duplicate
    addAllowedRoot(path.join(root, 'sub')) // subpath resolves to itself
    const roots = getAllowedRoots()
    expect(roots).toContain(path.resolve(root))
    expect(roots).toContain(path.resolve(path.join(root, 'sub')))
  })

  it('ignores empty / non-string input', () => {
    addAllowedRoot('')
    addAllowedRoot(123 as unknown as string)
    expect(getAllowedRoots()).toHaveLength(0)
  })
})
