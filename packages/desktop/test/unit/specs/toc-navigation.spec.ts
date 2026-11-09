import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` transitively imports `@/config`, which reads `window.path`
// at module load and reaches `window.electron` at runtime. Stub those surfaces
// (normally injected by the preload bridge) before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { countTopLevelHeadings, resolveTocHeadingElement } from '@/util/tocNavigation'

describe('useEditorStore UPDATE_TOC', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('seeds the flat listToc and the nested tree from an engine snapshot', () => {
    const store = useEditorStore()
    store.UPDATE_TOC([
      { slug: 'uid-1', githubSlug: 'intro', content: 'Intro', lvl: 1 },
      { slug: 'uid-2', githubSlug: 'details', content: 'Details', lvl: 2 }
    ])

    expect(store.listToc.map((i) => i.slug)).toEqual(['uid-1', 'uid-2'])
    // listToTree nests the lvl-2 entry under the lvl-1 entry.
    expect(store.toc).toHaveLength(1)
    expect(store.toc[0].slug).toBe('uid-1')
    expect(store.toc[0].children).toHaveLength(1)
    expect(store.toc[0].children[0].slug).toBe('uid-2')
  })

  it('re-seeds unconditionally, even when the new snapshot deep-equals the old', () => {
    const store = useEditorStore()
    const first = [{ slug: 'uid-1', githubSlug: 'intro', content: 'Intro', lvl: 1 }]
    store.UPDATE_TOC(first)
    const prevListToc = store.listToc

    // A fresh array with identical content (mirrors re-seeding the SAME document
    // on a tab switch). There is no `equal` guard, so the new snapshot must
    // replace the old reference rather than be short-circuited.
    store.UPDATE_TOC([{ slug: 'uid-1', githubSlug: 'intro', content: 'Intro', lvl: 1 }])
    expect(store.listToc).not.toBe(prevListToc)
    expect(store.listToc).toEqual(prevListToc)
  })

  it('resets to empty for a nullish snapshot', () => {
    const store = useEditorStore()
    store.UPDATE_TOC([{ slug: 'uid-1', githubSlug: 'intro', content: 'Intro', lvl: 1 }])
    store.UPDATE_TOC(undefined as unknown as never)
    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
  })
})

describe('resolveTocHeadingElement', () => {
  // Mirror the live editor structure: the scroll container the host passes in is
  // muya's root (`.mu-editor`), which WRAPS the scrollPage root (`.mu-container`)
  // whose DIRECT children are the top-level blocks. A blockquote-nested heading
  // and a raw-HTML heading sit BETWEEN the two top-level headings — `getTOC`
  // skips both, so `listToc` only carries the two top-level headings. Building
  // the wrapper here guards against re-introducing a `:scope >`-on-the-scroller
  // selector that would match zero headings (the headings are one level deeper).
  const buildContainer = (): HTMLElement => {
    const container = document.createElement('div')
    container.className = 'editor-component mu-editor'
    container.innerHTML = `
      <div class="mu-container">
        <h1>Top One</h1>
        <blockquote><h2>Nested heading</h2></blockquote>
        <div class="mu-html-block"><h2>Raw HTML heading</h2></div>
        <h2>Top Two</h2>
      </div>
    `
    return container
  }

  const listToc = [
    { slug: 'uid-1', githubSlug: 'top-one', content: 'Top One', lvl: 1 },
    { slug: 'uid-2', githubSlug: 'top-two', content: 'Top Two', lvl: 2 }
  ]

  it('resolves the first top-level heading', () => {
    const container = buildContainer()
    const el = resolveTocHeadingElement(container, listToc, 'uid-1')
    expect(el?.textContent).toBe('Top One')
  })

  it('resolves the second top-level heading, skipping nested / raw-HTML headings', () => {
    const container = buildContainer()
    const el = resolveTocHeadingElement(container, listToc, 'uid-2')
    // The regression: an unscoped `querySelectorAll('h1..h6')[1]` would return
    // the blockquote-nested "Nested heading" here. The scoped query lands on the
    // real top-level "Top Two".
    expect(el?.textContent).toBe('Top Two')
  })

  it('returns null when the slug is not in the TOC', () => {
    const container = buildContainer()
    expect(resolveTocHeadingElement(container, listToc, 'missing')).toBeNull()
  })

  it('returns null when the index has no matching DOM heading', () => {
    const container = document.createElement('div')
    container.className = 'mu-editor'
    container.innerHTML = '<div class="mu-container"><h1>Only one</h1></div>'
    // listToc claims two headings but the DOM has one — guard against overrun.
    expect(resolveTocHeadingElement(container, listToc, 'uid-2')).toBeNull()
  })
})

describe('countTopLevelHeadings', () => {
  it('counts only the top-level headings the TOC also enumerates', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="mu-container">
        <h1>Top One</h1>
        <blockquote><h3>Nested heading</h3></blockquote>
        <h2>Top Two</h2>
      </div>
    `
    expect(countTopLevelHeadings(container)).toBe(2)
  })

  it('reports fewer headings than the TOC when virtualization detached blocks', () => {
    // SB (PERF-04): blocks outside the rendered band are replaced by
    // `.mu-virtual-placeholder` slots, so the DOM only holds a subset of the
    // document headings. The caller compares this count against the TOC length
    // to know whether `resolveTocHeadingElement`'s index mapping is valid:
    // before the fix the host indexed the sparse list and scrolled to whichever
    // heading happened to be mounted.
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="mu-container">
        <h1>Top One</h1>
        <div class="mu-virtual-placeholder" style="height: 480px"></div>
        <div class="mu-virtual-placeholder" style="height: 520px"></div>
      </div>
    `
    const listToc = [{ slug: 'uid-1' }, { slug: 'uid-2' }, { slug: 'uid-3' }]
    expect(countTopLevelHeadings(container)).toBe(1)
    // The sparse list still "resolves" index 1 — to nothing distinguishable from
    // the real second heading. That silent wrong answer is why the count gate
    // exists: it is the only signal that materializing is required.
    expect(resolveTocHeadingElement(container, listToc, 'uid-2')).toBeNull()
    expect(countTopLevelHeadings(container)).not.toBe(listToc.length)
  })
})
