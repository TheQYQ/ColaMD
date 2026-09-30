import { describe, expect, it } from 'vitest'
import { decodeLinkPathname } from 'common/filesystem/paths'

// #27 item 1: the `mt::format-link-click` handler ran `decodeURIComponent` on the
// link target with no guard. A bare `%` is legal in a file name, and
// `decodeURIComponent` throws `URIError: URI malformed` on anything that is not
// `%` + two hex digits -- inside an `ipcMain.on` handler, which `typedOn` does not
// wrap in try/catch. The result was a main-process error dialog and a link that
// silently did nothing.

describe('decodeLinkPathname', () => {
  it('never throws on a percent that is not an escape', () => {
    // These all threw before: URIError: URI malformed.
    for (const raw of [
      '/docs/100%done.md',
      '/docs/50%.md',
      '/docs/%.md',
      '/docs/%zz.md',
      '/docs/价%格.md',
      'C:\\docs\\100%done.md'
    ]) {
      expect(() => decodeLinkPathname(raw), raw).not.toThrow()
      expect(decodeLinkPathname(raw), raw).toBe(raw)
    }
  })

  it('still decodes the encodings the feature exists for (issue #57)', () => {
    expect(decodeLinkPathname('/docs/My%20Image.png')).toBe('/docs/My Image.png')
    expect(decodeLinkPathname('/docs/100%25done.md')).toBe('/docs/100%done.md')
    expect(decodeLinkPathname('/docs/%E4%B8%AD%E6%96%87.md')).toBe('/docs/中文.md')
  })

  it('leaves an ordinary path untouched', () => {
    expect(decodeLinkPathname('/docs/note.md')).toBe('/docs/note.md')
    expect(decodeLinkPathname('/docs/a+b.md')).toBe('/docs/a+b.md')
  })

  it('documents the ambiguity it cannot resolve', () => {
    // A file literally named `a%41b.md` is opened as `aAb.md`. The two forms are
    // indistinguishable and decoding is the documented behaviour, so this is the
    // accepted remainder of the fix, not a regression -- pinned so nobody
    // "fixes" it by dropping decoding altogether.
    expect(decodeLinkPathname('/docs/a%41b.md')).toBe('/docs/aAb.md')
  })

  it('handles the empty string without inventing a path', () => {
    expect(decodeLinkPathname('')).toBe('')
  })
})
