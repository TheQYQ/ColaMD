import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clickMenuById,
  closeApp,
  ensureTocVisible,
  enterSourceMode,
  launchWithMarkdown,
  waitForEditor
} from './helpers'

// GUI_FIX_PLAN §8 "总验收" item 4: source-mode typing must not degrade
// linearly with document size (B3 + SB). The muya perf baseline covers
// WYSIWYG keystrokes and source-mode *rendering*; this is the missing
// source-mode *typing* measurement, in the real Electron renderer.
//
// Opt-in: CI runs every spec in test/e2e, and a three-size typing benchmark
// plus a 2 MB wrapped document would add tens of seconds to every PR for a
// number that only changes when the typing pipeline does. Run it with
// COLAMD_PERF_BENCH=1 and record the output in packages/muya/docs/perf-baseline.md.

// The call stays on one line on purpose: `test/unit/specs/skip-ledger.spec.ts`
// reads conditional gates line-anchored, and a wrapped call hides the
// condition from it (so the registered exemption below cannot match).
// prettier-ignore
test.skip(process.env.COLAMD_PERF_BENCH !== '1', 'source-mode performance benchmark — set COLAMD_PERF_BENCH=1 to run')

const MB = 1024 * 1024
const SIZES = [
  { label: '100KB', bytes: 100 * 1024 },
  { label: '500KB', bytes: 500 * 1024 },
  { label: '1MB', bytes: MB }
]

const KEY_BATCH = 40

const buildTypingDoc = (targetBytes: number): string => {
  const parts: string[] = []
  let bytes = 0
  let i = 0
  while (bytes < targetBytes) {
    const line =
      i % 100 === 0
        ? `# Heading ${i / 100}`
        : `第 ${i} 行：源码模式键入 filler 中英混排 text for the typing benchmark.`
    parts.push(line)
    bytes += Buffer.byteLength(line, 'utf8') + 1
    i++
  }
  return `${parts.join('\n')}\n`
}

interface TypingSample {
  perKeyMs: number
  typingBlockedMs: number
  longTasksDuringTyping: number
  pauseBlockedMs: number
}

// One batch of 40 keys typed back-to-back. Playwright awaits each key, and the
// renderer handles it synchronously, so wall time includes whatever the
// keystroke tier does — plus a constant ~5 ms per-key CDP/Playwright overhead.
// That constant is why the report also includes the fastest sample: it removes
// most scheduler noise, while the median is what a run-to-run reader sees.
// The 600 ms pause afterwards is longer than the 120 ms commit debounce: its
// long tasks are measured separately so the O(N) pause commit is visible but
// not mixed into the per-key figure.
const sampleTyping = async (page: Page): Promise<TypingSample> => {
  await page.evaluate(() => {
    const wrapper = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { lineCount(): number; setCursor(c: unknown): void } })
      | null
    const cm = wrapper?.CodeMirror
    if (cm) cm.setCursor({ line: Math.min(3, cm.lineCount() - 1), ch: 0 })
    const w = window as unknown as { __lt?: number[]; __po?: PerformanceObserver }
    const durations: number[] = []
    w.__lt = durations
    try {
      w.__po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration)
      })
      w.__po.observe({ entryTypes: ['longtask'] })
    } catch {
      // `longtask` is Chromium-only; the wall-time figure below still stands.
    }
  })

  const text = 'abcdefghij'.repeat(KEY_BATCH / 10)
  const started = Date.now()
  await page.keyboard.type(text)
  const elapsed = Date.now() - started

  const duringTyping = await page.evaluate(() => {
    const w = window as unknown as { __lt?: number[]; __po?: PerformanceObserver }
    const durations = w.__lt ?? []
    w.__po?.disconnect()
    w.__lt = []
    return {
      blocked: durations.reduce((a, b) => a + b, 0),
      count: durations.length
    }
  })

  // Let the debounced commit land while its own long tasks are observed.
  await page.evaluate(() => {
    const w = window as unknown as { __lt?: number[]; __po?: PerformanceObserver }
    const durations: number[] = []
    w.__lt = durations
    try {
      w.__po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration)
      })
      w.__po.observe({ entryTypes: ['longtask'] })
    } catch {
      // ignore
    }
  })
  await page.waitForTimeout(600)
  const duringPause = await page.evaluate(() => {
    const w = window as unknown as { __lt?: number[]; __po?: PerformanceObserver }
    const durations = w.__lt ?? []
    w.__po?.disconnect()
    return durations.reduce((a, b) => a + b, 0)
  })

  return {
    perKeyMs: elapsed / KEY_BATCH,
    typingBlockedMs: duringTyping.blocked,
    longTasksDuringTyping: duringTyping.count,
    pauseBlockedMs: duringPause
  }
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

for (const size of SIZES) {
  test(`typing in source mode: ${size.label}`, async () => {
    test.setTimeout(180_000)
    let app: ElectronApplication | null = null
    try {
      const launched = await launchWithMarkdown(buildTypingDoc(size.bytes))
      app = launched.app
      const page = launched.page
      await waitForEditor(page)
      await enterSourceMode(page, app)
      const chars = await page.evaluate(() => {
        const wrapper = document.querySelector('.source-code .CodeMirror') as
          | (Element & { CodeMirror?: { getValue(): string } })
          | null
        return wrapper?.CodeMirror?.getValue().length ?? -1
      })

      const samples: TypingSample[] = []
      for (let i = 0; i < 5; i++) samples.push(await sampleTyping(page))
      const perKey = median(samples.map((s) => s.perKeyMs))
      const fastest = Math.min(...samples.map((s) => s.perKeyMs))
      const blocked = median(samples.map((s) => s.typingBlockedMs))
      const pause = median(samples.map((s) => s.pauseBlockedMs))

      console.log(
        `[source-mode-typing] ${size.label} chars=${chars} perKeyMs=${perKey.toFixed(2)} ` +
          `fastestPerKeyMs=${fastest.toFixed(2)} ` +
          `typingBlockedMs=${blocked.toFixed(0)} pauseBlockedMs=${pause.toFixed(0)} ` +
          `samples=${samples.map((s) => s.perKeyMs.toFixed(2)).join(',')}`
      )

      // Loose regression bounds, not a performance budget: they catch an order
      // of magnitude (B3's full-document `getValue()` + word count returned),
      // and the cross-size ratio is the §8 claim itself.
      expect(perKey).toBeLessThan(30)
    } finally {
      if (app) await closeApp(app)
    }
  })
}

// #151: `lineWrapping: true` + a finite `viewportMargin` can only measure
// heights of wrapped lines inside the rendered window; everything else is
// estimated. The SB step 3 numbers came from short (unwrapped) lines, so this
// records scrollHeight consistency, far-jump landing and last-line reachability
// with 400-character lines.
const WRAP_LINES = 5050
const WRAP_CHARS = 400
const WRAP_HEADINGS = 50

const buildWrappedDoc = (): string => {
  const parts: string[] = []
  for (let i = 0; i < WRAP_LINES; i++) {
    if (i % (WRAP_LINES / WRAP_HEADINGS) === 0) parts.push(`# Heading ${i}`)
    parts.push(`line ${i} `.padEnd(WRAP_CHARS, 'wrap-filler-'))
  }
  return `${parts.join('\n')}\n`
}

const WYSIWYG_HEADING = '# Heading '

type WrappedCm = Element & {
  CodeMirror?: {
    getScrollerElement(): HTMLElement
    lineAtHeight(h: number, mode: string): number
    lineCount(): number
  }
}

const scrollState = (page: Page): Promise<{ top: number; height: number; lastLine: number }> =>
  page.evaluate(() => {
    const wrapper = document.querySelector('.source-code .CodeMirror') as WrappedCm | null
    const cm = wrapper?.CodeMirror
    if (!cm) return { top: -1, height: -1, lastLine: -1 }
    const scroller = cm.getScrollerElement()
    return {
      top: Math.round(scroller.scrollTop),
      height: Math.round(scroller.scrollHeight),
      lastLine: cm.lineAtHeight(scroller.scrollTop + scroller.clientHeight - 2, 'local')
    }
  })

const settleScroll = async (page: Page): Promise<number> => {
  let last = -1
  await expect
    .poll(
      async () => {
        const { top } = await scrollState(page)
        const stable = top === last
        last = top
        return stable ? top : -1
      },
      { timeout: 20_000, intervals: [300, 300, 300] }
    )
    .toBeGreaterThanOrEqual(0)
  return last
}

test('lineWrapping + finite viewportMargin: heights, far jump, last line', async () => {
  test.setTimeout(240_000)
  let app: ElectronApplication | null = null
  try {
    const launched = await launchWithMarkdown(buildWrappedDoc())
    app = launched.app
    const page = launched.page
    await waitForEditor(page)
    await enterSourceMode(page, app)
    const lineCount = await page.evaluate(() => {
      const wrapper = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { lineCount(): number } })
        | null
      return wrapper?.CodeMirror?.lineCount() ?? -1
    })

    const topState = await scrollState(page)
    await page.evaluate(() => {
      const wrapper = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getScrollerElement(): HTMLElement } })
        | null
      const scroller = wrapper?.CodeMirror?.getScrollerElement()
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
    await settleScroll(page)
    const bottomState = await scrollState(page)
    await page.evaluate(() => {
      const wrapper = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getScrollerElement(): HTMLElement } })
        | null
      const scroller = wrapper?.CodeMirror?.getScrollerElement()
      if (scroller) scroller.scrollTop = 0
    })
    await settleScroll(page)
    const backState = await scrollState(page)

    // Far jump through the app's TOC path (the one with the scrollend
    // correction pass), not `cm.scrollIntoView`.
    const sbVisible = await page.evaluate(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    })
    if (!sbVisible) await clickMenuById(app, 'sideBarMenuItem')
    await ensureTocVisible(app, page)
    const lastHeadingLine = (WRAP_HEADINGS - 1) * (WRAP_LINES / WRAP_HEADINGS)
    // The TOC label is the heading text without the leading `#`; the source
    // line in the editor does carry it.
    const lastHeading = `Heading ${lastHeadingLine}`
    await page.locator('.side-bar-toc').getByText(lastHeading, { exact: true }).click()
    await settleScroll(page)
    const landedTop = await page.evaluate((needle) => {
      const scroller = (
        document.querySelector('.source-code .CodeMirror') as
          | (Element & { CodeMirror?: { getScrollerElement(): HTMLElement } })
          | null
      )?.CodeMirror?.getScrollerElement()
      const lines = Array.from(document.querySelectorAll('.source-code .CodeMirror-line'))
      const target = lines.find((l) => (l.textContent || '').startsWith(needle)) as
        | HTMLElement
        | undefined
      if (!scroller || !target) return null
      return Math.round(target.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
    }, `${WYSIWYG_HEADING}${lastHeadingLine}`)

    console.log(
      `[source-mode-wrap] lines=${lineCount} top=${topState.height} bottom=${bottomState.height} ` +
        `back=${backState.height} lastLineAtBottom=${bottomState.lastLine} ` +
        `headingTop=${String(landedTop)}`
    )

    // Consistency is what #151 asks for; the exact drift is recorded above.
    expect(Math.abs(topState.height - bottomState.height)).toBeLessThan(120)
    expect(Math.abs(backState.height - bottomState.height)).toBeLessThan(120)
    // Last line must be reachable (lineAtHeight returns a 0-based index).
    expect(bottomState.lastLine).toBeGreaterThanOrEqual(lineCount - 3)
    // #151 fix: the coarse fraction passes bring the target line into the
    // rendered window before the ±2px nudge, so the heading lands near the top.
    // Before the fix this measured -17,796 ~ -17,823 (see perf-baseline); the
    // bounds below are the same ones the short-line TOC spec uses.
    expect(landedTop).not.toBeNull()
    expect(landedTop as number).toBeLessThan(150)
    expect(landedTop as number).toBeGreaterThan(-5)
  } finally {
    if (app) await closeApp(app)
  }
})
