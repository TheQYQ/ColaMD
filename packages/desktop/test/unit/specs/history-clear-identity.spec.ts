import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { stripTopLevelImports } from '../sfcScriptHarness'

// #28 item 1 fixed two halves of this file: `loadSnapshots` and `openPreview` both
// guard their write-back against a superseded request. `clearAll` was left with
// the same shape it has always had, and it is the only one of the three whose
// stale write is DESTRUCTIVE:
//
//   const clearAll = async () => {
//     if (!currentPathname.value) return
//     try { await ElMessageBox.confirm(...) } catch { return }
//     const success = await window.versionHistory.clear(currentPathname.value)
//     if (success) snapshots.value = []
//   }
//
// `currentPathname.value` is read at call time for the early return but RE-READ
// after the confirm dialog resolves, so the pathname handed to
// `window.versionHistory.clear` is whatever is current at that later moment.
// `clearHistory()` in the main process is `fs.unlinkSync` on that file
// (main/versionHistory/index.ts:140) — it drops the whole history, unrecoverably.
//
// Reachability does not depend on the mouse: the confirm overlay blocks page
// clicks, but `Ctrl+Tab` / `Ctrl+1..9` / `Ctrl+P` are main-process accelerators
// (main/keyboard/keybindingsWindows.ts:108-115, :122 -> main/commands/), so the
// focused file can change while the box is open. Then confirming deletes the
// OTHER file's history and leaves the one on screen untouched.
//
// The second half: `snapshots.value = []` applies unconditionally, so a late
// answer also wipes whatever list the panel has since reloaded for the newly
// selected file.
//
// Both are made DETERMINISTIC here rather than timed: `ElMessageBox.confirm`
// and `window.versionHistory.clear` hand back promises the test resolves by
// hand, so the file switch provably happens between the two awaits. Same
// SFC-driving approach as `history-preview-stale.spec.ts`.

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

// `loadSnapshots` is reached through `nextTick` from the immediate watcher and
// then awaits `versionHistory.list`, so settling it takes several microtask
// turns. One `await nextTick()` is not enough — the first draft of this spec
// failed on the *setup* (list had not landed yet), which would have hidden the
// real symptom.
const flush = async (turns = 12): Promise<void> => {
  for (let i = 0; i < turns; i++) await nextTick()
}

interface Snapshot {
  pathname: string
  id: string
  timestamp: number
}

const A = '/docs/alpha.md'
const B = '/docs/beta.md'
const snapOf = (pathname: string, id: string, timestamp: number): Snapshot => ({
  pathname,
  id,
  timestamp
})

interface SetupBindings {
  snapshots: { value: Snapshot[] }
  clearAll: () => Promise<void>
  deleteSnapshot: (snapshot: Snapshot) => Promise<void>
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

const boot = () => {
  const alphaSnap = snapOf(A, 'snap-a1', 1000)
  const betaSnaps = [snapOf(B, 'snap-b1', 2000), snapOf(B, 'snap-b2', 3000)]

  // `storeToRefs` has to hand back `currentFile`, because that is the binding
  // the component destructures; `currentPathname` is a computed over it.
  const currentFile = ref<{ pathname: string; isSaved: boolean }>({
    pathname: A,
    isSaved: true
  })

  const confirms: Deferred<unknown>[] = []
  const clears: { pathname: string; deferred: Deferred<boolean> }[] = []

  ;(globalThis as unknown as { window: unknown }).window = {
    versionHistory: {
      list: async (pathname: string) => (pathname === A ? [alphaSnap] : betaSnaps),
      getContent: async () => null,
      clear: (pathname: string) => {
        const d = deferred<boolean>()
        clears.push({ pathname, deferred: d })
        return d.promise
      },
      delete: async () => true
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
    // The real watcher is needed here: switching files is what makes the panel
    // re-read the list, and facet 2 is about that freshly loaded list.
    watch,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    nextTick,
    useEditorStore: () => ({ currentFile: currentFile.value }),
    storeToRefs: () => ({ currentFile }),
    useI18n: () => ({ t: (key: string) => key }),
    ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    ElMessageBox: {
      confirm: vi.fn(() => {
        const d = deferred<unknown>()
        confirms.push(d)
        return d.promise
      })
    },
    bus: { on: () => {}, off: () => {}, emit: () => {} },
    watchHistoryPanel: () => {}
  }

  const bindings = loadComponent(deps)
  return { bindings, currentFile, confirms, clears, alphaSnap, betaSnaps }
}

describe('history clear-all targets the file that was on screen', () => {
  it('clears the pathname captured before the confirm dialog, not the one current after it', async () => {
    const { bindings, currentFile, confirms, clears } = boot()
    await flush()

    // The panel is showing A's history; the user asks to clear it all.
    void bindings.clearAll()
    await flush()
    expect(confirms).toHaveLength(1)

    // While the dialog is up the focused file changes (main-process accelerator,
    // not a page click). This is the only place the race can be entered.
    currentFile.value = { pathname: B, isSaved: true }
    await flush()

    // The user confirms the dialog they were shown.
    confirms[0].resolve('confirm')
    await flush()

    expect(clears).toHaveLength(1)
    // A's history is what the user agreed to delete. The main process unlinks
    // that whole file, so getting this wrong is unrecoverable data loss.
    expect(clears[0].pathname).toBe(A)
  })

  it('does not wipe the newly loaded list when the answer lands after a file switch', async () => {
    const { bindings, currentFile, confirms, clears } = boot()
    await flush()

    void bindings.clearAll()
    await flush()

    currentFile.value = { pathname: B, isSaved: true }
    // Let the pathname watcher re-read the list, so the panel is showing B's
    // two snapshots by the time the clear answer arrives.
    await flush()
    // Raw insertion order, as `versionHistory.list` returned it; the descending
    // sort lives in the separate `sortedSnapshots` computed.
    expect(bindings.snapshots.value.map((s) => s.id)).toEqual(['snap-b1', 'snap-b2'])

    confirms[0].resolve('confirm')
    await flush()

    // The clear IPC is now in flight; settle it as a success.
    expect(clears).toHaveLength(1)
    clears[0].deferred.resolve(true)
    await clears[0].deferred.promise
    await flush()

    // The panel is still showing B, so its list must survive A's clear.
    expect(bindings.snapshots.value.map((s) => s.id)).toEqual(['snap-b1', 'snap-b2'])
  })

  it('still clears the list when nothing was switched (positive control)', async () => {
    const { bindings, confirms, clears, alphaSnap } = boot()
    await flush()
    expect(bindings.snapshots.value.map((s) => s.id)).toEqual([alphaSnap.id])

    void bindings.clearAll()
    await flush()
    confirms[0].resolve('confirm')
    await flush()

    expect(clears).toHaveLength(1)
    expect(clears[0].pathname).toBe(A)

    clears[0].deferred.resolve(true)
    await clears[0].deferred.promise
    await flush()

    expect(bindings.snapshots.value).toEqual([])
  })
})
