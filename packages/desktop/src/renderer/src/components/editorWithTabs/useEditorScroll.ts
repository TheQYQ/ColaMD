import { nextTick, ref } from 'vue'
import { animatedScrollTo } from '@/util'
import bus from '../../bus'

// O12 step 6 part B — the scroll/caret family moved out of `editor.vue`
// verbatim. Everything here answers the same question: given the engine's scroll
// container, where should it be scrolled to, and which outline entry does the
// current viewport belong to? The component keeps only the wiring, and the
// dependencies are injected as getters because `editor`, `sourceCode` and the
// resize observer are all created later in the component's lifecycle.
//
// The standard top offset (`STANDAR_Y`) is exported: the typewriter scroll in
// `editor.vue` computes against the same number, so it must stay one value.

export const STANDAR_Y = 320

interface ScrollDeps {
  getEditor: () => { readonly domNode?: unknown } | null
  getSourceCode: () => boolean
  getListToc: () => ReadonlyArray<{ slug?: string }>
  getResizeObserver: () => ResizeObserver
}

export const useEditorScroll = (deps: ScrollDeps) => {
  const { getEditor, getSourceCode, getListToc, getResizeObserver } = deps

  // `muya.domNode` is the contenteditable + scroll container (it inherits the
  // `.editor-component` class from the original mount point and `overflow:auto`).
  // The legacy engine exposed the same element as `muya.container`.
  const getScrollContainer = (): HTMLElement | null =>
    (getEditor()?.domNode as HTMLElement | undefined) ?? null

  // Sidebar outline follow (Typora parity): highlight the TOC entry of the
  // section currently in view. Heading blocks render in document order and the
  // store's listToc entries match that order, so the Nth visible heading maps to
  // the Nth TOC entry. Emits `toc-active-changed` with the entry's slug (empty
  // when the viewport sits above the first heading).
  const activeTocSlug = ref('')
  let tocHighlightScheduled = false
  const updateActiveTocEntry = () => {
    if (tocHighlightScheduled) return
    tocHighlightScheduled = true
    requestAnimationFrame(() => {
      tocHighlightScheduled = false
      const container = getScrollContainer()
      if (!container || getSourceCode()) return
      const headings = container.querySelectorAll('.mu-atx-heading, .mu-setext-heading')
      let slug = ''
      if (headings.length > 0) {
        const containerTop = container.getBoundingClientRect().top
        let activeIndex = -1
        for (let i = 0; i < headings.length; i++) {
          const top = (headings[i] as HTMLElement).getBoundingClientRect().top - containerTop
          if (top <= container.clientHeight * 0.3) activeIndex = i
          else break
        }
        if (activeIndex >= 0) slug = getListToc()[activeIndex]?.slug ?? ''
      }
      if (slug !== activeTocSlug.value) {
        activeTocSlug.value = slug
        bus.emit('toc-active-changed', slug)
      }
    })
  }

  // Viewport-relative caret rect (mirrors the engine's `Selection.getCursorCoords`
  // / legacy `cursorCoords`). Used for typewriter + keep-cursor-visible scrolling
  // when we are not inside a `selection-change` event (which already supplies it).
  const getCursorY = (): number | null => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    const range = sel.getRangeAt(0).cloneRange()
    let rects = range.getClientRects()
    if (rects.length === 0 && range.startContainer) {
      const parent =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement
      rects = parent ? parent.getClientRects() : rects
    }
    return rects.length ? rects[0].y : null
  }

  const scrollToCursor = (duration = 300) => {
    nextTick(() => {
      const container = getScrollContainer()
      if (!container) return
      const y = getCursorY()
      if (y == null) return
      animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
    })
  }

  const scrollToCords = (y: number) => {
    const container = getScrollContainer()
    if (!container) return
    // Depending on how much the user previously scrolled, sometimes the container has not fully rendered all elements.
    // Hence, container.scrollHeight < [saved scrollTop]
    // What we need to do is to temporarily add a padding to the container so that we can actually set the scrollTop without getting clamped.

    const maxScrollHeight = container.scrollHeight - container.clientHeight // max scroll height is actually calculated as such
    if (y > maxScrollHeight) {
      const editorId = container.firstElementChild as HTMLElement | null
      if (editorId) {
        editorId.style.paddingBottom = `${y - maxScrollHeight + 100}px` // 100px is the default editor padding
        // attach a resize observer so we know when to remove the padding when it is of the "correct" height
        getResizeObserver().observe(editorId)
      }
    }
    requestAnimationFrame(() => {
      if (!container) return
      // wait for the padding to be applied (if any)
      container.style.visibility = 'visible'
      container.style.pointerEvents = 'auto'
      container.scrollTop = y
    })
  }

  // Smoothly scroll the editor so `anchor` sits at the standard top offset.
  // Shared by the TOC, search-highlight, and any other "reveal this element"
  // caller so the getBoundingClientRect + animatedScrollTo math lives once.
  const scrollElementIntoView = (anchor: Element | null | undefined, duration = 300) => {
    const container = getScrollContainer()
    if (!container || !anchor) return
    const { y } = anchor.getBoundingClientRect()
    animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
  }

  const scrollToHighlight = () => {
    return scrollToElement('.mu-highlight')
  }

  // Scrolls to a non-heading in-document anchor target (e.g. a custom
  // `<a id="...">`) resolved by `FORMAT_LINK_CLICK` via `getElementById`.
  const scrollToAnchorElement = (element: unknown) => {
    if (element instanceof Element) scrollElementIntoView(element)
  }

  const scrollToElement = (selector: string) => {
    // Scroll to search highlight word
    scrollElementIntoView(document.querySelector(selector))
  }

  return {
    getScrollContainer,
    updateActiveTocEntry,
    getCursorY,
    scrollToCursor,
    scrollToCords,
    scrollElementIntoView,
    scrollToHighlight,
    scrollToAnchorElement,
    scrollToElement
  }
}
