/** Minimal CodeMirror surface `scrollSourceEditorToLine` needs. */
interface ISourceEditor {
  setCursor: (
    pos: { line: number; ch: number },
    ch?: number | null,
    options?: { scroll?: boolean }
  ) => void
  heightAtLine: (line: number, mode: 'local' | 'page' | 'div') => number
  getScrollerElement?: () => HTMLElement | null
  /**
   * Optional: the line at a local Y (CM5 `lineAtHeight`). When present, a jump
   * that lands far from the target in LINE terms gets a coarse pass first — see
   * `MAX_COARSE_CORRECTIONS`. Without it the function keeps its pixel-only
   * behaviour (handy for the existing unit fakes).
   */
  lineAtHeight?: (height: number, mode: 'local' | 'page' | 'div') => number
  /** Optional: used for the coarse fraction jump (CM5 `lineCount`). */
  lineCount?: () => number
}

/** A landing within this many pixels of the line's top counts as exact. */
const CORRECTION_TOLERANCE_PX = 2
/** Two fine nudges are enough in practice; the cap stops a non-converging document. */
const MAX_FINE_CORRECTIONS = 2
/**
 * #151: a wrapped document can land more than the rendered window away in LINE
 * terms, and then `heightAtLine` is still an estimate, so the pixel delta reads
 * ~0 while the heading is tens of thousands of pixels off. Coarse passes move
 * by the measured average height of the lines currently in the window, which
 * brings the target inside the rendered window; the fine pass then does the
 * exact ±2px landing.
 */
const MAX_COARSE_CORRECTIONS = 5
/** Within this many lines, the target is rendered and pixels can be trusted. */
const COARSE_TOLERANCE_LINES = 2

/**
 * Corrections still waiting for their `scrollend`, per scroller. A click whose
 * target is already in place scrolls nowhere, so no `scrollend` ever arrives —
 * without this the stale listener would fire on the NEXT jump and drag the view
 * back to the previous heading.
 */
const pendingCorrections = new WeakMap<HTMLElement, () => void>()
/**
 * Invalidates a scheduled re-measure when a newer jump starts on the same
 * scroller: `scrollend` only cancels listeners, not the frame callback that is
 * still waiting for CodeMirror to lay out the landing.
 */
const scrollRuns = new WeakMap<HTMLElement, number>()

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
 *
 * #151: for a wrapped document the estimate can be off by MORE than the
 * rendered window (measured -17.8k px on 5,100 lines × 400 chars), and then the
 * target never gets rendered — the pixel delta reads ~0 and the old loop gave
 * up silently. When `lineAtHeight` is available, compare the top LINE against
 * the target and move by the measured height of the lines in the window until
 * the target is rendered; the fine pass then lands it exactly.
 */
export function scrollSourceEditorToLine(editor: ISourceEditor, line: number): void {
  editor.setCursor({ line, ch: 0 }, null, { scroll: false })

  const scrollerMaybe = editor.getScrollerElement?.()
  if (!scrollerMaybe) return
  // Re-bind as non-nullable: the frame callbacks below read it after the guard,
  // and TypeScript does not carry the optional-call narrowing into closures.
  const scroller: HTMLElement = scrollerMaybe

  pendingCorrections.get(scroller)?.()
  const runId = (scrollRuns.get(scroller) ?? 0) + 1
  scrollRuns.set(scroller, runId)

  let coarseCorrections = 0
  let fineCorrections = 0
  const cancel = (): void => {
    scroller.removeEventListener('scrollend', onScrollEnd)
    if (pendingCorrections.get(scroller) === cancel) pendingCorrections.delete(scroller)
  }

  // A proportional jump by LINE NUMBER against the scroller's total height.
  // `heightAtLine` cannot be trusted here: for unmeasured lines CodeMirror's
  // estimate collapses (measured 10px/line vs the real 88 on the wrapped
  // fixture), so summing those heights under-shoots by tens of thousands of
  // pixels. `scrollHeight / lineCount` is a global average and stays sane even
  // when only part of the document is measured; repeated passes converge because
  // each landing re-measures the region it lands in.
  const coarseTarget = (): number | null => {
    const count = editor.lineCount?.()
    const maxScroll = scroller.scrollHeight - scroller.clientHeight
    if (!count || count <= 1 || maxScroll <= 0) return null
    const fraction = line / (count - 1)
    return Math.max(0, Math.min(maxScroll, fraction * maxScroll))
  }

  const arm = (): void => {
    pendingCorrections.set(scroller, cancel)
    scroller.addEventListener('scrollend', onScrollEnd)
  }

  function onScrollEnd(): void {
    cancel()
    // `scrollend` fires before CodeMirror has measured the newly rendered
    // window (it updates the display in its own animation frame). Measuring
    // here reads the OLD line tree, where the lines ahead of the viewport are
    // still estimates — measured 10px/line instead of the real 88 on the
    // wrapped fixture, which under-shot the coarse target badly. Wait two
    // frames (layout + CM's measure) before deciding.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(measure))
    } else {
      measure()
    }
  }

  function measure(): void {
    if (scrollRuns.get(scroller) !== runId) return
    const topLine = editor.lineAtHeight?.(scroller.scrollTop, 'local')
    if (
      typeof topLine === 'number' &&
      topLine >= 0 &&
      Math.abs(line - topLine) > COARSE_TOLERANCE_LINES &&
      coarseCorrections < MAX_COARSE_CORRECTIONS
    ) {
      const target = coarseTarget()
      if (target != null && Math.abs(target - scroller.scrollTop) > CORRECTION_TOLERANCE_PX) {
        coarseCorrections += 1
        arm()
        scroller.scrollTo({ top: target, behavior: 'smooth' })
        return
      }
    }

    if (fineCorrections >= MAX_FINE_CORRECTIONS) return
    const delta = Math.round(scroller.scrollTop - editor.heightAtLine(line, 'local'))
    if (Math.abs(delta) <= CORRECTION_TOLERANCE_PX) return
    fineCorrections += 1
    arm()
    scroller.scrollBy({ top: -delta, behavior: 'smooth' })
  }

  arm()
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
