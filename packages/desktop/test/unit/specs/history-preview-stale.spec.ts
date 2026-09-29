import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, reactive, ref } from 'vue'
import { stripTopLevelImports } from '../sfcScriptHarness'

// #28 item 1: `openPreview` awaits a disk read and then wrote
// `preview.content` / `preview.loading` unconditionally, so clicking snapshot A
// and then B let A's late answer appear under B's label and cleared B's loading
// spinner. `loadSnapshots` in the same file already had the guard; this closes
// the half that was left.
//
// The race is made DETERMINISTIC here rather than timed: `getContent` hands back
// promises the test resolves by hand, so A can only ever land after B was
// selected. Same SFC-driving approach as `source-code-image-action.spec.ts`.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/sideBar/history.vue')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void
  // The executor parameter has to be named `resolve` (promise/param-names); the
  // Promise constructor runs it synchronously, so `settle` is assigned by return.
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

interface PreviewState {
  visible: boolean
  loading: boolean
  meta: { pathname: string; id: string } | null
  content: string
}

interface SetupBindings {
  preview: PreviewState
  openPreview: (snapshot: PreviewState['meta']) => Promise<void>
  __returned__?: SetupBindings
}

const loadComponent = (deps: Record<string, unknown>): SetupBindings => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  const js = ts.transpileModule(stripTopLevelImports(compiled.content), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, computed, ref, reactive, watch, onMounted, onBeforeUnmount, nextTick,
      useEditorStore, storeToRefs, useI18n, ElMessage, ElMessageBox, bus,
      watchHistoryPanel } = __deps
    ${js}
    return module.exports`
  ) as (
    deps: Record<string, unknown>,
    exports: object,
    module: object
  ) => {
    default: {
      setup: (
        props: unknown,
        ctx: { expose: () => void }
      ) => SetupBindings & Record<string, unknown>
    }
  }
  const m = { exports: {} as Record<string, unknown> }
  const bindings = factory(deps, m.exports, m).default.setup(null, { expose: () => {} })
  // `compileScript` exposes the setup bindings through the dev-mode
  // `__returned__` object; fall back to the returned object itself.
  return (bindings.__returned__ ?? bindings) as SetupBindings
}

const A = { pathname: '/docs/note.md', id: 'snap-a' }
const B = { pathname: '/docs/note.md', id: 'snap-b' }

const boot = (): {
  preview: PreviewState
  openPreview: SetupBindings['openPreview']
  reads: Deferred<string | null>[]
} => {
  const currentPathname = { value: A.pathname }
  const reads: Deferred<string | null>[] = []
  const store = { currentFile: { pathname: A.pathname, isSaved: true } }
  ;(globalThis as unknown as { window: unknown }).window = {
    versionHistory: {
      list: async () => [A, B],
      getContent: async () => {
        const d = deferred<string | null>()
        reads.push(d)
        return d.promise
      }
    },
    electron: { ipcRenderer: { on: () => {}, send: () => {} } },
    path: { sep: '/', dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) },
    fileUtils: { isSamePathSync: (a: string, b: string) => a === b }
  }

  const deps = {
    _defineComponent: (o: unknown) => o,
    computed,
    ref,
    reactive,
    watch: (source: unknown, cb: () => void) => {
      // The panel's watcher fires immediately in the real component; skip it so
      // the only in-flight request under test is the one openPreview starts.
      void source
      void cb
    },
    onMounted: () => {},
    onBeforeUnmount: () => {},
    nextTick,
    useEditorStore: () => store,
    storeToRefs: () => ({ currentPathname }),
    useI18n: () => ({ t: (key: string) => key }),
    ElMessage: { error: vi.fn(), success: vi.fn() },
    ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) },
    bus: { on: () => {}, off: () => {}, emit: () => {} },
    watchHistoryPanel: () => {}
  }
  const bindings = loadComponent(deps)
  return { ...bindings, reads }
}

describe('history preview stale response', () => {
  it('drops the late answer of a superseded snapshot click', async () => {
    const { preview, openPreview, reads } = boot()

    void openPreview(A)
    void openPreview(B)
    await nextTick()
    expect(reads).toHaveLength(2)

    // B is now the selected snapshot (the component set preview.meta when the
    // second click arrived); A's read is the one that must be ignored.
    expect(preview.meta?.id).toBe(B.id)
    reads[0].resolve('A-CONTENT')
    await reads[0].promise
    await nextTick()

    expect(preview.content).not.toBe('A-CONTENT')
    // And A's completion must not end B's spinner.
    expect(preview.loading).toBe(true)

    reads[1].resolve('B-CONTENT')
    await reads[1].promise
    await nextTick()

    expect(preview.content).toBe('B-CONTENT')
    expect(preview.loading).toBe(false)
  })

  it('still renders the content of the snapshot that is selected', async () => {
    const { preview, openPreview, reads } = boot()

    void openPreview(B)
    await nextTick()
    reads[0].resolve('ONLY-CONTENT')
    await reads[0].promise
    await nextTick()

    expect(preview.content).toBe('ONLY-CONTENT')
    expect(preview.loading).toBe(false)
  })
})
