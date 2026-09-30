/* eslint-disable no-template-curly-in-string -- `${filename}` is the product's own
   substitution token inside a preference value, so these fixtures are supposed to
   contain the sequence. The rule exists for accidentally quoting a template. */
import { describe, expect, it, vi } from 'vitest'

// Importing the composable pulls `config.ts`, which reads `window.path.sep` at
// module load, and the store chain behind it. Stub the preload surfaces before
// the hoisted imports run (same shape the other image specs use).
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      DIRNAME?: string
      path?: Record<string, unknown>
      fileUtils?: unknown
      electron?: unknown
      colamd?: unknown
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    dirname: (p: string) => p.replace(/\/[^/]*$/, '') || '/',
    basename: (p: string) => p.split('/').pop() ?? p,
    extname: (p: string) => /\.[^.]*$/.exec(p)?.[0] ?? '',
    isAbsolute: (p: string) => p.startsWith('/'),
    join: (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/'),
    normalize: (p: string) => p,
    resolve: (...parts: string[]) => `/${parts.join('/')}`.replace(/\/{2,}/g, '/')
  }
  w.window.DIRNAME = '/docs'
})

import { resolveImageFilenameToken } from '@/components/editorWithTabs/useEditorImages'

// The image path templates (`imageFolderPath`, the relative-directory name) may
// carry the `${filename}` token, which is substituted with the open document's
// name. Both sides are user data, and the substitution used to hand the filename
// to `String#replace` as a REPLACEMENT STRING, where `$&`, `$``, `$'` and `$$`
// are not literal -- so a document named `my$$file.md` silently wrote its images
// into `my$file/`, and `a$&b.md` into a folder literally named `${filename}`.

describe('resolveImageFilenameToken', () => {
  it('substitutes the token with the stem of the file name', () => {
    expect(resolveImageFilenameToken('/assets/${filename}', 'report.md', true)).toBe(
      '/assets/report'
    )
  })

  it('substitutes an empty string when the caller has no saved file', () => {
    expect(resolveImageFilenameToken('/assets/${filename}', 'report.md', false)).toBe('/assets/')
  })

  it('treats dollar patterns in the file name as literal text', () => {
    for (const filename of ['my$$file.md', 'a$&b.md', 'x$1.md', 'p$q.md', "tail'$1.md"]) {
      const stem = filename.replace(/\.[^/.]+$/, '')
      expect(resolveImageFilenameToken('/${filename}/img', filename, true)).toBe(`/${stem}/img`)
    }
  })

  it('treats dollar patterns in the template as literal text', () => {
    // The template comes from the preference field, so `$$` there must survive too.
    expect(resolveImageFilenameToken('/cost/$$/${filename}', 'report.md', true)).toBe(
      '/cost/$$/report'
    )
  })

  it('replaces every occurrence of the token', () => {
    expect(resolveImageFilenameToken('${filename}/${filename}/x', 'a.md', true)).toBe('a/a/x')
  })

  it('leaves a template without the token untouched', () => {
    expect(resolveImageFilenameToken('/assets/img', 'a$&b.md', true)).toBe('/assets/img')
  })
})
