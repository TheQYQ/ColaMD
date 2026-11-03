/** Minimal CodeMirror surface `scrollSourceEditorToLine` needs. */
interface ISourceEditor {
  setCursor: (
    pos: { line: number; ch: number },
    ch?: number | null,
    options?: { scroll?: boolean }
  ) => void
  heightAtLine: (line: number, mode: 'local' | 'page' | 'div') => number
  getScrollerElement?: () => HTMLElement | null
}

/** A landing within this many pixels of the line's top counts as exact. */
const CORRECTION_TOLERANCE_PX = 2
/** One nudge is enough in practice; the cap stops a non-converging document. */
const MAX_CORRECTIONS = 2

/**
 * Corrections still waiting for their `scrollend`, per scroller. A click whose
 * target is already in place scrolls nowhere, so no `scrollend` ever arrives —
 * without this the stale listener would fire on the NEXT jump and drag the view
 * back to the previous heading.
 */
const pendingCorrections = new WeakMap<HTMLElement, () => void>()

/**
 * Scroll the Source Code editor so `line` sits at the TOP of the viewport,
 * animated.
 *
 * SB (PERF-04) step 3: CodeMirror runs with a finite `viewportMargin`, so its
 * own `.CodeMirror-scroll` is the scrolling element again (the outer
 * `.source-code` container no longer overflows). Scroll the scroller to the
 * line's local Y — CodeMirror's `scrollIntoView` only scrolled minimally,
 * leaving the heading at the bottom edge with no animation. `setCursor` gets
 * `scroll: false` so its native caret-into-view scroll doesn't fight the
 * animation.
 *
 * A line far outside the rendered window has never been measured, so
 * `heightAtLine` sums CM's estimated line heights for everything above it and
 * the first landing is a line or two off (28-36px at 5k lines, and the error
 * grows with the document). Once the animation settles the target HAS been
 * rendered, so re-measuring gives the real offset and one nudge puts the line
 * where the user asked for it.
 */
export function scrollSourceEditorToLine(editor: ISourceEditor, line: number): void {
  editor.setCursor({ line, ch: 0 }, null, { scroll: false })

  const scroller = editor.getScrollerElement?.()
  if (!scroller) return

  pendingCorrections.get(scroller)?.()

  let corrections = 0
  const cancel = (): void => {
    scroller.removeEventListener('scrollend', onScrollEnd)
    if (pendingCorrections.get(scroller) === cancel) pendingCorrections.delete(scroller)
  }
  const onScrollEnd = (): void => {
    cancel()
    if (corrections >= MAX_CORRECTIONS) return
    const delta = Math.round(scroller.scrollTop - editor.heightAtLine(line, 'local'))
    if (Math.abs(delta) <= CORRECTION_TOLERANCE_PX) return
    corrections += 1
    pendingCorrections.set(scroller, cancel)
    scroller.addEventListener('scrollend', onScrollEnd)
    scroller.scrollBy({ top: -delta, behavior: 'smooth' })
  }

  pendingCorrections.set(scroller, cancel)
  scroller.addEventListener('scrollend', onScrollEnd)
  scroller.scrollTo({ top: editor.heightAtLine(line, 'local'), behavior: 'smooth' })
}

/**
 * Find the 0-based line number of the `headingIndex`-th markdown heading
 * (ATX `# foo` or setext `foo\n===`) in document order, skipping fenced code
 * blocks. Returns -1 when not found.
 *
 * Used by Source Code mode to resolve a TOC entry (whose order matches the
 * document heading order muya builds the TOC from) to a CodeMirror line.
 */
export function findMarkdownHeadingLine(markdown: string, headingIndex: number): number {
  if (headingIndex < 0) return -1

  const lines = markdown.split('\n')
  let fence: string | null = null
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Toggle fenced-code-block state on ``` / ~~~ markers.
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue

    // ATX heading.
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      if (count === headingIndex) return i
      count++
      continue
    }

    // Setext heading: a non-blank line immediately followed by an `===`/`---`
    // underline.
    const next = lines[i + 1]
    if (line.trim() !== '' && next !== undefined && /^ {0,3}(?:=+|-+)\s*$/.test(next)) {
      if (count === headingIndex) return i
      count++
      i++ // consume the underline line
    }
  }

  return -1
}

/**
 * Inverse of `findMarkdownHeadingLine`: the document-order index of the last
 * heading at or above `cursorLine` (-1 when the caret sits above the first
 * heading). One pass, same heading rules as `findMarkdownHeadingLine`, so the
 * index maps 1:1 onto the muya TOC entry order. Used by Source Code mode to
 * keep the sidebar outline highlighted on the section the caret is in.
 */
export function findActiveHeadingIndex(markdown: string, cursorLine: number): number {
  const lines = markdown.split('\n')
  let fence: string | null = null
  let index = -1

  const bound = Math.min(cursorLine, lines.length - 1)
  for (let i = 0; i <= bound; i++) {
    const line = lines[i]

    // Toggle fenced-code-block state on ``` / ~~~ markers.
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue

    // ATX heading.
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      index++
      continue
    }

    // Setext heading: a non-blank line immediately followed by an `===`/`---`
    // underline.
    const next = lines[i + 1]
    if (line.trim() !== '' && next !== undefined && /^ {0,3}(?:=+|-+)\s*$/.test(next)) {
      index++
      i++ // consume the underline line
    }
  }

  return index
}
