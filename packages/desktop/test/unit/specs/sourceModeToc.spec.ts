import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'

// colamd #3580: in Source Code mode, clicking a TOC entry must scroll the
// CodeMirror editor to the heading's line. This resolves a TOC index to a line.
describe('findMarkdownHeadingLine', () => {
  const doc = [
    '# First', // 0
    '', // 1
    'text', // 2
    '', // 3
    '## Second', // 4
    '', // 5
    'Setext', // 6
    '------', // 7  (setext h2 underline for line 6)
    '', // 8
    '### Third' // 9
  ].join('\n')

  it('finds the line of the N-th heading (ATX + setext, in order)', () => {
    expect(findMarkdownHeadingLine(doc, 0)).toBe(0) // # First
    expect(findMarkdownHeadingLine(doc, 1)).toBe(4) // ## Second
    expect(findMarkdownHeadingLine(doc, 2)).toBe(6) // Setext (setext heading)
    expect(findMarkdownHeadingLine(doc, 3)).toBe(9) // ### Third
  })

  it('returns -1 for an out-of-range index', () => {
    expect(findMarkdownHeadingLine(doc, 4)).toBe(-1)
    expect(findMarkdownHeadingLine(doc, -1)).toBe(-1)
  })

  it('ignores `#` and `---` inside fenced code blocks', () => {
    const fenced = [
      '# Real', // 0
      '', // 1
      '```', // 2
      '# not a heading', // 3
      'fake setext', // 4
      '---', // 5
      '```', // 6
      '', // 7
      '## AlsoReal' // 8
    ].join('\n')
    expect(findMarkdownHeadingLine(fenced, 0)).toBe(0)
    expect(findMarkdownHeadingLine(fenced, 1)).toBe(8)
  })
})

// colamd #3580 follow-up, contract changed by SB (PERF-04) step 3: CodeMirror
// runs with a finite `viewportMargin`, so its OWN scroller is the scrollable
// element again (the outer `.source-code` container no longer overflows). A far
// jump also needs one correction pass: `heightAtLine` measures lines that were
// never rendered from estimated heights, so the first landing is a line or two
// off and only becomes measurable once the target has been rendered.
type SourceEditor = Parameters<typeof scrollSourceEditorToLine>[0]

interface FakeScroller {
  scrollTop: number
  scrollTo: ReturnType<typeof vi.fn>
  scrollBy: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  fireScrollEnd: () => void
}

const makeScroller = (sticky = false): FakeScroller => {
  const listeners: Array<() => void> = []
  const el = {
    scrollTop: 0,
    scrollTo: vi.fn((opts: { top?: number }) => {
      if (!sticky && typeof opts.top === 'number') el.scrollTop = opts.top
    }),
    scrollBy: vi.fn((opts: { top?: number }) => {
      if (!sticky && typeof opts.top === 'number') el.scrollTop += opts.top
    }),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      if (type === 'scrollend') listeners.push(cb)
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      const at = listeners.indexOf(cb)
      if (at >= 0) listeners.splice(at, 1)
    }),
    fireScrollEnd: (): void => {
      for (const cb of [...listeners]) cb()
    }
  }
  return el
}

const makeEditor = (
  heights: number[],
  sticky = false
): {
  editor: SourceEditor
  setCursor: ReturnType<typeof vi.fn>
  heightAtLine: ReturnType<typeof vi.fn>
  scroller: FakeScroller
} => {
  const scroller = makeScroller(sticky)
  const setCursor = vi.fn()
  const heightAtLine = vi.fn(() => {
    const next = heights.length > 1 ? heights.shift() : heights[0]
    return next ?? 0
  })
  const editor = {
    setCursor,
    heightAtLine,
    getScrollerElement: () => scroller
  } as unknown as SourceEditor
  return { editor, setCursor, heightAtLine, scroller }
}

describe('scrollSourceEditorToLine', () => {
  // Production defers the decision by two frames so CodeMirror can measure the
  // landing (see onScrollEnd); these fakes are synchronous, so run the handler
  // synchronously instead of waiting on the frame clock.
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('smooth-scrolls the CodeMirror scroller so the line sits at the top', () => {
    const { editor, setCursor, heightAtLine, scroller } = makeEditor([480])

    scrollSourceEditorToLine(editor, 12)

    expect(heightAtLine).toHaveBeenCalledWith(12, 'local')
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 480, behavior: 'smooth' })
    expect(setCursor).toHaveBeenCalledWith({ line: 12, ch: 0 }, null, { scroll: false })
  })

  it('re-measures once the jump has rendered and nudges out the estimate error', () => {
    // 480 was computed while the target was outside the rendered window; after
    // the scroll the same line really sits 28px higher.
    const { editor, scroller } = makeEditor([480, 452])

    scrollSourceEditorToLine(editor, 12)
    expect(scroller.scrollTop).toBe(480)

    scroller.fireScrollEnd()

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: -28, behavior: 'smooth' })
  })

  it('does not nudge when the landing is already within tolerance', () => {
    const { editor, scroller } = makeEditor([480, 479])

    scrollSourceEditorToLine(editor, 12)
    scroller.fireScrollEnd()

    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })

  it('stops correcting after the estimate refuses to converge', () => {
    // A pathological document that keeps reporting the same stale height, on a
    // scroller that never actually moves — the delta can never converge.
    const { editor, scroller } = makeEditor([480, 480], true)

    scrollSourceEditorToLine(editor, 12)
    for (let i = 0; i < 5; i++) scroller.fireScrollEnd()

    expect(scroller.scrollBy.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('drops a correction left armed by a click that never scrolled', () => {
    // First click lands on the line the view is already showing: nothing
    // scrolls, so no `scrollend` arrives and its listener stays armed.
    const { editor, heightAtLine, scroller } = makeEditor([480, 480, 900])
    scrollSourceEditorToLine(editor, 12)
    heightAtLine.mockClear()

    // A later click on a far line scrolls. The stale listener must be gone, or
    // it would drag the view back to the previous heading.
    scrollSourceEditorToLine(editor, 30)
    scroller.fireScrollEnd()

    expect(heightAtLine).toHaveBeenCalledWith(30, 'local')
    expect(heightAtLine).not.toHaveBeenCalledWith(12, 'local')
  })

  it('still places the caret but does not throw when the editor exposes no scroller', () => {
    const setCursor = vi.fn()
    const heightAtLine = vi.fn(() => 480)
    const editor = { setCursor, heightAtLine } as unknown as SourceEditor

    scrollSourceEditorToLine(editor, 5)

    expect(setCursor).toHaveBeenCalledWith({ line: 5, ch: 0 }, null, { scroll: false })
    expect(heightAtLine).not.toHaveBeenCalled()
  })

  // #151: on a wrapped document the estimate can miss by more than the rendered
  // window, so `heightAtLine(target)` stays an estimate and the old pixel delta
  // read ~0 (measured -17.8k px off on 5,100 × 400-char lines). The coarse pass
  // must bring the target line into the window before the exact nudge.
  it('coarse-aligns a wrapped far jump that lands outside the rendered window', () => {
    const ACTUAL = 78 // px per (wrapped) line
    const ESTIMATE = 73 // CM's unmeasured estimate, ~6% low
    const RENDERED = 200 // viewportMargin, in lines
    const target = 4949
    let scrollTop = 0
    const listeners: Array<() => void> = []
    const scroller = {
      get scrollTop() {
        return scrollTop
      },
      scrollHeight: 5100 * ACTUAL,
      clientHeight: 754,
      scrollTo: vi.fn((opts: { top?: number }) => {
        scrollTop = opts.top ?? scrollTop
      }),
      scrollBy: vi.fn((opts: { top?: number }) => {
        scrollTop += opts.top ?? 0
      }),
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === 'scrollend') listeners.push(cb)
      }),
      removeEventListener: vi.fn((type: string, cb: () => void) => {
        const at = listeners.indexOf(cb)
        if (at >= 0) listeners.splice(at, 1)
      }),
      fireScrollEnd: () => {
        for (const cb of [...listeners]) cb()
      }
    }
    const topLine = (): number => Math.floor(scrollTop / ACTUAL)
    const heightAtLine = vi.fn((line: number) => {
      const measured = Math.abs(line - topLine()) <= RENDERED
      return line * (measured ? ACTUAL : ESTIMATE)
    })
    const editor = {
      setCursor: vi.fn(),
      heightAtLine,
      lineAtHeight: (height: number) => Math.floor(height / ACTUAL),
      lineCount: () => 5100,
      getScrollerElement: () => scroller
    } as unknown as SourceEditor

    scrollSourceEditorToLine(editor, target)
    // Estimate lands ~318 lines short; the coarse fraction jump must move it
    // into the rendered window before the pixel pass.
    scroller.fireScrollEnd()
    scroller.fireScrollEnd()
    scroller.fireScrollEnd()

    expect(scroller.scrollTo).toHaveBeenCalledTimes(2) // initial + one coarse pass
    expect(scroller.scrollBy).toHaveBeenCalledTimes(1) // the exact ±2px nudge
    expect(scrollTop).toBeCloseTo(target * ACTUAL, 0)
  })

  it('caps the coarse passes when the line index never converges', () => {
    const scrollTop = 0
    const listeners: Array<() => void> = []
    const scroller = {
      get scrollTop() {
        return scrollTop
      },
      scrollHeight: 5100 * 78,
      clientHeight: 754,
      scrollTo: vi.fn(() => undefined), // scroller never moves
      scrollBy: vi.fn(() => undefined),
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === 'scrollend') listeners.push(cb)
      }),
      removeEventListener: vi.fn((type: string, cb: () => void) => {
        const at = listeners.indexOf(cb)
        if (at >= 0) listeners.splice(at, 1)
      }),
      fireScrollEnd: () => {
        for (const cb of [...listeners]) cb()
      }
    }
    const editor = {
      setCursor: vi.fn(),
      heightAtLine: (line: number) => line * 78,
      lineAtHeight: () => 0, // stuck: always reports the document top
      lineCount: () => 5100,
      getScrollerElement: () => scroller
    } as unknown as SourceEditor

    scrollSourceEditorToLine(editor, 4949)
    for (let i = 0; i < 5; i++) scroller.fireScrollEnd()

    expect(scroller.scrollTo.mock.calls.length).toBeLessThanOrEqual(6) // initial + 5 capped
    expect(scroller.scrollBy.mock.calls.length).toBeLessThanOrEqual(2) // capped fine passes
    expect(scrollTop).toBe(0)
  })
})
