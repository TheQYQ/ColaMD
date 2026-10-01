import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computed, ref, watch } from 'vue'
import { loadSfcSetup } from '../sfcScriptHarness'

// Round 6, third batch. `menuBar/index.vue`'s `openMenu` reads the menu object
// BEFORE the recent-documents fetch and calls `items()` on it AFTER:
//
//   const menu = menus.value[index]        // :65
//   ...
//   if (menu.id === 'file') await fetchRecentFiles()   // :83 -> reassigns recentFiles
//   openIndex.value = index                        // :85
//   openItems.value = menu.items()                 // :86
//
// `menus` is a computed over `recentFiles`, and `buildMenus` hands out `items` as
// a THUNK closing over the array it was given (menus.ts:712:
// `items: () => buildFileMenu(recentFiles, hasFile)`). `buildFileMenu` maps that
// array into `recentChildren` eagerly (menus.ts:248), and `fetchRecentFiles`
// REASSIGNS `recentFiles.value` (:110) instead of mutating it — so the captured
// menu keeps pointing at the pre-fetch array.
//
//  => B1a: the File menu's "recent documents" list is permanently one fetch
//     behind. First open shows nothing at all; every later open shows the
//     previous list. Deterministic, on every open — not a race.
//
//  => B1b: `openIndex` AND `openItems` are both written after the await, so a
//     superseded open puts them back. `hoverMenu` (:98) only early-returns while
//     `openIndex` is null, and `openIndex` is not bumped until after the fetch —
//     so a hover, an arrow-key move (:132) or `closeAll` landing inside the fetch
//     window gets undone when the answer arrives.
//
// The real `buildMenus` is used on purpose: the defect lives in its thunk
// closure, so stubbing it would only test a reproduction of the contract. The
// fetch is settled by hand, so both orderings are provable rather than timed.

// `config.ts` reads `window.path.sep` at MODULE scope, and the `buildMenus`
// import below is hoisted above any global the test installs later. Without this
// the whole spec dies at load with "Cannot read properties of undefined
// (reading 'sep')" — a setup failure that would hide the real symptom.
vi.hoisted(() => {
  ;(globalThis as unknown as { window: { path: { sep: string } } }).window.path = { sep: '/' }
})

vi.mock('@/bus', () => ({ default: { emit: vi.fn() } }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/store/preferences', () => ({ usePreferencesStore: () => ({ autoSave: false }) }))
vi.mock('@/store/layout', () => ({ useLayoutStore: () => ({}) }))
vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({ currentFile: { pathname: '/a.md' } })
}))
vi.mock('@/store/commandCenter', () => ({
  useCommandCenterStore: () => ({ rootCommand: { subcommands: [] } })
}))

import { buildMenus } from '@/menu/menus'

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/menuBar/index.vue')

// Menu ids in the order `buildMenus` returns them.
const FILE = 0
const EDIT = 1
const FORMAT = 3

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

interface MenuItemLike {
  label?: string
  enabled?: boolean
  children?: MenuItemLike[]
}

interface Bindings {
  openIndex: { value: number | null }
  openItems: { value: MenuItemLike[] }
  recentFiles: { value: string[] }
  toggleMenu: (index: number, event: unknown) => void
  hoverMenu: (index: number, event: unknown) => void
  closeAll: () => void
  __returned__?: Bindings
}

const fakeEvent = { currentTarget: null, stopPropagation: (): void => {} }

const boot = () => {
  const fetches: Deferred<string[]>[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    // `PATH_SEPARATOR` was already captured from the hoisted `window.path`, but
    // keep it here so anything reading it during a build still works.
    path: { sep: '/' },
    electron: {
      ipcRenderer: {
        invoke: (channel: string) => {
          if (channel !== 'mt::menu::get-recent-documents') {
            throw new Error(`unexpected channel ${channel}`)
          }
          const d = deferred<string[]>()
          fetches.push(d)
          return d.promise
        },
        send: vi.fn()
      }
    }
  }

  const titleBarStyle = ref('custom')
  const deps = {
    // `compileScript` wraps the setup in `_defineComponent`; `loadSfcSetup`
    // injects exactly the names in this object, so anything the compiled output
    // evaluates must be listed or it throws at load time.
    _defineComponent: (o: unknown) => o,
    computed,
    ref,
    watch,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    storeToRefs: () => ({ titleBarStyle }),
    usePreferencesStore: () => ({}),
    isOsx: false,
    buildMenus,
    MenuList: {}
  }

  const setup = loadSfcSetup<Bindings>(vuePath, deps)
  const raw = setup({}, { expose: () => {} })
  return { bindings: (raw.__returned__ ?? raw) as Bindings, fetches }
}

// The labels the File menu shows under "Open Recent", i.e. what the user sees.
const recentLabels = (openItems: MenuItemLike[]): string[] => {
  const openRecent = openItems.find((i) => i.label === 'menu.file.openRecent')
  return (openRecent?.children ?? []).map((c) => c.label ?? '')
}

const flush = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

describe('menu bar: the File menu must show the recents it just fetched', () => {
  it('renders the list the in-flight fetch returned, not the one captured before it', async () => {
    const { bindings, fetches } = boot()

    // The user clicks File. `openMenu` grabs the menu object first, then fetches.
    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    expect(fetches).toHaveLength(1)

    // The fetch answers with one document.
    fetches[0].resolve(['/docs/alpha.md', '/docs/beta.md'])
    await fetches[0].promise
    await flush()

    // This is the whole point of the fetch: the dropdown must list what it
    // returned. Before the fix `menu.items()` runs against the pre-fetch array,
    // so both entries are missing.
    expect(recentLabels(bindings.openItems.value)).toContain('alpha.md')
    expect(recentLabels(bindings.openItems.value)).toContain('beta.md')
  })

  it('picks up recents added between two opens (no permanent one-open lag)', async () => {
    const { bindings, fetches } = boot()

    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    fetches[0].resolve(['/docs/alpha.md'])
    await fetches[0].promise
    await flush()
    expect(recentLabels(bindings.openItems.value)).toEqual(expect.arrayContaining(['alpha.md']))

    // Close, and a new document shows up in main.
    bindings.closeAll()
    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    fetches[1].resolve(['/docs/alpha.md', '/docs/gamma.md'])
    await fetches[1].promise
    await flush()

    expect(recentLabels(bindings.openItems.value)).toContain('gamma.md')
  })
})

describe('menu bar: a superseded open is not undone by the late fetch answer', () => {
  it('keeps the menu the user hovered to while the File fetch was in flight', async () => {
    const { bindings, fetches } = boot()

    // Open Edit first, so `openIndex` is non-null: `hoverMenu` early-returns
    // while it is null, and `openMenu` does not bump it until after the fetch.
    void bindings.toggleMenu(EDIT, fakeEvent)
    await flush()
    expect(bindings.openIndex.value).toBe(EDIT)

    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    expect(fetches).toHaveLength(1)
    // The fetch has not answered, so the bar still shows Edit.
    expect(bindings.openIndex.value).toBe(EDIT)

    // The user slides along the bar to Format before the answer lands.
    void bindings.hoverMenu(FORMAT, fakeEvent)
    await flush()
    expect(bindings.openIndex.value).toBe(FORMAT)

    fetches[0].resolve(['/docs/alpha.md'])
    await fetches[0].promise
    await flush()

    // The File answer is now stale. It must not drag the bar back.
    expect(bindings.openIndex.value).toBe(FORMAT)
  })

  it('does not reopen the menu when it was closed during the fetch', async () => {
    const { bindings, fetches } = boot()

    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    expect(fetches).toHaveLength(1)

    // The user clicks away (mousedown handler -> closeAll) before the answer.
    bindings.closeAll()
    await flush()
    expect(bindings.openIndex.value).toBeNull()

    fetches[0].resolve(['/docs/alpha.md'])
    await fetches[0].promise
    await flush()

    // A late answer must not resurrect the dropdown the user just dismissed.
    expect(bindings.openIndex.value).toBeNull()
  })

  it('still opens the File menu when nothing overtook it (positive control)', async () => {
    const { bindings, fetches } = boot()

    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    expect(bindings.openIndex.value).toBeNull()

    fetches[0].resolve(['/docs/alpha.md'])
    await fetches[0].promise
    await flush()

    // Only the open/close subject here. Asserting the rendered recents as well
    // would drag B1a into this case, and then it stops being a control for the
    // seq guard: it would go red for a defect the seq guard has nothing to do
    // with, and the two fixes could no longer be located independently.
    expect(bindings.openIndex.value).toBe(FILE)
  })

  it('toggling the same menu closed still works (positive control for the seq guard)', async () => {
    const { bindings, fetches } = boot()

    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    fetches[0].resolve([])
    await fetches[0].promise
    await flush()
    expect(bindings.openIndex.value).toBe(FILE)

    // Second click on the already-open File menu closes it.
    void bindings.toggleMenu(FILE, fakeEvent)
    await flush()
    expect(bindings.openIndex.value).toBeNull()
  })
})
