import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computed, nextTick, ref } from 'vue'
import { loadSfcSetup } from '../sfcScriptHarness'

// #28 item 4. `updateCommands()` wrote whatever `cmd.search()` answered, with no
// newest-wins check. Backspacing quick-open to empty answers synchronously with
// the list of open tabs, while the directory search started by the previous
// keystroke is still running -- and `ripgrepSearcher` *resolves* (it does not
// reject) on `mt::rg::cancelled`, so the older answer lands afterwards and
// refills the panel with the query the user just deleted. Enter opens that file.
//
// The palette is driven through the real `<script setup>` (see
// test/unit/sfcScriptHarness.ts); only `cmd.search` is faked, because that is the
// boundary the component cannot control.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/commandPalette/index.vue')

interface Palette {
  query: { value: string }
  currentCommand: { value: Record<string, unknown> | null }
  availableCommands: { value: Array<{ id: string }> }
  selectedCommandIndex: { value: number }
  updateCommands: () => void
}

const deferred = <T>(value: T) => {
  let settle: ((v: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle: () => settle?.(value) }
}

const deferredFailure = () => {
  let fail: ((e: unknown) => void) | undefined
  const promise = new Promise<Array<{ id: string }>>((resolve, reject) => {
    // `resolve` is deliberately unused: this one only ever settles by failing.
    fail = reject
  })
  promise.catch(() => {})
  return { promise, fail: (e: unknown) => fail?.(e) }
}

const loadPalette = (): Palette => {
  const setup = loadSfcSetup<Palette>(vuePath, {
    _defineComponent: (o: unknown) => o,
    ref,
    computed,
    nextTick,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    onBeforeUpdate: () => {},
    bus: { on: () => {}, off: () => {}, emit: vi.fn() },
    log: { error: vi.fn() },
    useCommandCenterStore: () => ({ rootCommand: {} }),
    useI18n: () => ({ t: (k: string) => k }),
    loading: {}
  })
  return setup()
}

const ids = (palette: Palette): string[] => palette.availableCommands.value.map((c) => c.id)

describe('command palette search results', () => {
  it('drops an answer that arrives after a newer query was already answered', async () => {
    const palette = loadPalette()
    const stale = deferred([{ id: 'stale-x.md' }])
    const fresh = deferred([{ id: 'tabs-only.md' }])

    palette.currentCommand.value = { search: () => stale.promise }
    palette.query.value = 'x'
    palette.updateCommands()

    // Backspace to empty: the empty query answers at once with the tab list.
    palette.currentCommand.value = { search: () => fresh.promise }
    palette.query.value = ''
    palette.updateCommands()
    fresh.settle()
    await nextTick()
    expect(ids(palette)).toEqual(['tabs-only.md'])

    // The search started for "x" finishes later. It must not come back.
    stale.settle()
    await nextTick()
    await nextTick()
    expect(ids(palette)).toEqual(['tabs-only.md'])
    expect(palette.selectedCommandIndex.value).toBe(0)
  })

  it('still applies the answer of the newest query', async () => {
    const palette = loadPalette()
    const latest = deferred([{ id: 'newest.md' }])

    palette.currentCommand.value = { search: () => latest.promise }
    palette.query.value = 'x'
    palette.updateCommands()

    latest.settle()
    await nextTick()
    await nextTick()
    expect(ids(palette)).toEqual(['newest.md'])
  })

  it('does not let a superseded failure wipe the list', async () => {
    const palette = loadPalette()
    const stale = deferredFailure()
    const fresh = deferred([{ id: 'tabs-only.md' }])

    palette.currentCommand.value = { search: () => stale.promise }
    palette.query.value = 'x'
    palette.updateCommands()

    palette.currentCommand.value = { search: () => fresh.promise }
    palette.query.value = ''
    palette.updateCommands()
    fresh.settle()
    await nextTick()
    expect(ids(palette)).toEqual(['tabs-only.md'])

    // The older call now reports its error -- after the panel has moved on. The
    // catch branch used to clear the list and the selection on the way.
    stale.fail({ message: 'boom' })
    await nextTick()
    await nextTick()
    expect(ids(palette)).toEqual(['tabs-only.md'])
    expect(palette.selectedCommandIndex.value).toBe(0)
  })
})
