import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_INCLUSIONS, hasMarkdownExtension } from 'common/filesystem/paths'

// O22 — the sandboxed preload kept its own copy of the markdown extension list,
// so `window.fileUtils.hasMarkdownExtension` was a look-alike of the authority in
// `common/filesystem/paths` rather than the same code. The two could drift without
// any test noticing, and the copy also ignored the boot handshake it claimed to
// depend on. These specs load the real preload with an empty boot-info reply, so a
// re-introduced inline copy (or a list that only exists inside the handshake) fails.

const exposed = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api)
  },
  ipcRenderer: {
    sendSync: () => undefined,
    invoke: () => Promise.resolve(undefined),
    on: () => {},
    once: () => {},
    removeListener: () => {},
    removeAllListeners: () => {}
  },
  webFrame: { setZoomFactor: () => {} },
  webUtils: { getPathForFile: () => '' }
}))

interface FileUtilsSurface {
  MARKDOWN_INCLUSIONS: readonly string[]
  hasMarkdownExtension: (filename: string) => boolean
}

const loadPreloadSurface = async (): Promise<FileUtilsSurface> => {
  await import('../../../src/preload/index')
  const api = exposed.get('fileUtils') as FileUtilsSurface | undefined
  if (!api) throw new Error('preload did not expose window.fileUtils')
  return api
}

describe('O22 — one markdown extension list', () => {
  it('exposes the authoritative inclusion patterns even with an empty boot handshake', async () => {
    const fileUtils = await loadPreloadSurface()
    expect([...fileUtils.MARKDOWN_INCLUSIONS]).toEqual([...MARKDOWN_INCLUSIONS])
  })

  it('forwards the shared predicate instead of a duplicated copy', async () => {
    const fileUtils = await loadPreloadSurface()
    expect(fileUtils.hasMarkdownExtension).toBe(hasMarkdownExtension)
  })

  it('classifies the same names as the authority', async () => {
    const fileUtils = await loadPreloadSurface()
    const markdown = [
      'note.md',
      'NOTE.MD',
      'a.markdown',
      'a.mdown',
      'a.mkdn',
      'a.mkd',
      'a.mdwn',
      'a.mdtxt',
      'a.mdtext',
      'a.mdx',
      'a.text',
      'a.txt',
      '/tmp/dir.a/README.md'
    ]
    const others = ['photo.png', 'data.json', 'Makefile', 'archive.tar', 'notes.mdb', '', 'md']
    for (const name of markdown) expect(fileUtils.hasMarkdownExtension(name)).toBe(true)
    for (const name of others) expect(fileUtils.hasMarkdownExtension(name)).toBe(false)
  })
})
