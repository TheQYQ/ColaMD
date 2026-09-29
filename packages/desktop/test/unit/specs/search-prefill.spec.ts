import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { ref, computed, watch, nextTick } from 'vue'
import { createSeqGuard } from '@/components/search/searchRegexProbe'
import { stripTopLevelImports } from '../sfcScriptHarness'

// Regression guard for the find-bar prefill race (issue: the input showed a
// stale single char like "T" instead of the selection). The bug lives entirely
// in search/index.vue's reactive logic: `watch(searchMatches)` mirrors the
// editor selection into the input, but when the find bar opens it steals focus
// and the engine emits a spurious selection-change pointing at the document
// start, which clobbers the just-prefilled value.
//
// The desktop unit runner ships no @vitejs/plugin-vue / @vue/test-utils, so we
// compile the real <script setup> at runtime, swap its imports for injected
// stubs (but keep Vue's *real* ref/computed/watch/nextTick), run setup() to grab
// the live bindings, and drive the actual reactive code. This mirrors the
// approach in source-code-image-action.spec.ts.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/search/index.vue')

interface Bindings {
  searchValue: { value: string }
  showSearch: { value: boolean }
  isRegexp: { value: boolean }
  searchErrorMsg: { value: string }
  listenFind: () => void
  emptySearch: (selectHighlight?: boolean) => void
}

const loadComponent = (deps: Record<string, unknown>) => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  // Per statement, not per line -- see test/unit/sfcScriptHarness.ts.
  const noImports = stripTopLevelImports(compiled.content)
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, ref, computed, watch, onMounted, onBeforeUnmount,
      nextTick, bus, FindCaseIcon, FindWordIcon, FindRegexIcon, useEditorStore,
      storeToRefs, useI18n, debounce, createSeqGuard, probeSearchRegex,
      ArrowDown, ArrowUp, RefreshRight, Switch } = __deps
    ${js}
    return module.exports`
  ) as (
    deps: Record<string, unknown>,
    exports: object,
    module: object
  ) => {
    default: { setup: (props: unknown, ctx: { expose: () => void }) => Bindings }
  }
  const m = { exports: {} as Record<string, unknown> }
  return factory(deps, m.exports, m).default
}

const makeBindings = (overrides: Record<string, unknown> = {}) => {
  // currentFile.searchMatches is the channel SELECTION_CHANGE writes the
  // selected text into; storeToRefs hands the component a ref to it.
  const currentFile = ref<{
    searchMatches: { matches: unknown[]; index: number; value: string }
  } | null>({
    searchMatches: { matches: [], index: -1, value: '' }
  })
  const emit = vi.fn()
  const deps = {
    _defineComponent: (o: unknown) => o,
    ref,
    computed,
    watch,
    nextTick,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    bus: { on: () => {}, off: () => {}, emit },
    FindCaseIcon: {},
    FindWordIcon: {},
    FindRegexIcon: {},
    ArrowDown: {},
    ArrowUp: {},
    RefreshRight: {},
    Switch: {},
    useEditorStore: () => new Proxy({}, { get: () => () => {} }),
    storeToRefs: () => ({ currentFile }),
    useI18n: () => ({ t: (k: string) => k }),
    debounce: (fn: (...a: unknown[]) => unknown) => fn,
    // Every binding the setup evaluates must be injected, not only the ones these
    // cases exercise: setup calls createSeqGuard() immediately, while
    // probeSearchRegex is only reached on the regex path — a missing binding is a
    // run-time ReferenceError, so this harness silently drifts behind the
    // component's import list. The real guard is imported rather than stubbed so
    // the newest-call-wins behaviour exercised here is the shipped one.
    createSeqGuard,
    probeSearchRegex: vi.fn(async () => ({ status: 'ok', matchCount: 0 })),
    ...overrides
  }
  const comp = loadComponent(deps)
  const ret = comp.setup({}, { expose: () => {} })
  const setSelection = (value: string) => {
    currentFile.value = { searchMatches: { matches: [], index: -1, value } }
  }
  return { ret, setSelection, emit }
}

describe('find-bar prefill from selection', () => {
  it('prefills the input with the selected text when the bar opens', async () => {
    const { ret, setSelection } = makeBindings()
    setSelection('fox')
    await nextTick()
    ret.listenFind()
    await nextTick()
    expect(ret.searchValue.value).toBe('fox')
  })

  it('does not let the focus-steal selection-change clobber the prefill', async () => {
    const { ret, setSelection } = makeBindings()
    // User selects a word in the editor.
    setSelection('fox')
    await nextTick()
    // Find bar opens (prefills "fox") and steals focus.
    ret.listenFind()
    await nextTick()
    expect(ret.searchValue.value).toBe('fox')
    // Opening the bar steals editor focus → the engine emits a spurious
    // selection-change pointing at the document start ("T"). It must NOT
    // overwrite the prefilled query now that the bar owns it.
    setSelection('T')
    await nextTick()
    expect(ret.showSearch.value).toBe(true)
    expect(ret.searchValue.value).toBe('fox')
  })
})

// #28 item 3. `emptySearch` (Escape, or any click inside the document) hides the
// bar and clears the input, but the `searchValue` watch early-returns while the
// bar is hidden -- so nothing took a newer sequence number, and a `searchFn`
// parked on the ReDoS probe stayed "latest" and seconds later handed the engine
// back a query the user had already thrown away.
const withDeferredProbe = (resolution: unknown = { status: 'ok', matchCount: 2 }) => {
  let settle: ((value: unknown) => void) | undefined
  const deps = {
    useEditorStore: () => ({ currentFile: { markdown: 'banana banana\n' } }),
    probeSearchRegex: vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
  }
  const bindings = makeBindings(deps)
  return { ...bindings, settle: () => settle?.(resolution) }
}

const startRegexSearch = async (ret: Bindings): Promise<void> => {
  ret.showSearch.value = true
  ret.isRegexp.value = true
  ret.searchValue.value = '(a+)+'
  await nextTick()
  await nextTick()
}

describe('discarding the find bar while the ReDoS probe is in flight', () => {
  it('does not hand the discarded query back to the engine', async () => {
    const { ret, emit, settle } = withDeferredProbe()
    await startRegexSearch(ret)

    ret.emptySearch()
    settle()
    await nextTick()
    await nextTick()

    expect(emit).not.toHaveBeenCalledWith(
      'searchValue',
      expect.objectContaining({ value: '(a+)+' })
    )
  })

  it('still applies the query when nothing discarded it', async () => {
    const { ret, emit, settle } = withDeferredProbe()
    await startRegexSearch(ret)

    settle()
    await nextTick()
    await nextTick()

    expect(emit).toHaveBeenCalledWith('searchValue', expect.objectContaining({ value: '(a+)+' }))
  })

  // The same guard is what keeps a late timeout off the bar: the report is
  // written after the await, so before this it could name a query the user had
  // already discarded.
  it('does not report a timeout for a query that was discarded', async () => {
    const { ret, settle } = withDeferredProbe({ status: 'timeout', matchCount: 0 })
    await startRegexSearch(ret)

    ret.emptySearch()
    settle()
    await nextTick()
    await nextTick()

    expect(ret.searchErrorMsg.value).toBe('')
  })
})
