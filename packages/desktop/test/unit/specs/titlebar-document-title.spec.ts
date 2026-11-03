import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { loadSfcSetup } from '../sfcScriptHarness'

// #GUI-B1 UX-01. The window title is the only dirty-state signal visible from
// the taskbar / window switcher, and the old watch only tracked `filename` —
// flipping `isSaved` (typing, then saving) left the title stale. These cases
// drive the real `<script setup>` (same harness as
// titlebar-window-state-identity.spec.ts) and pin three behaviors:
//
//   1. the title carries the `●` marker while the current file is unsaved;
//   2. the marker appears/clears when `isSaved` flips, with no filename change;
//   3. the watch applies immediately on setup, so a dirty restore-from-session
//      does not show a clean title until the first keystroke.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/titleBar/index.vue')

interface BootOptions {
  filename?: string
  project?: { name: string } | null
  currentFile?: { isSaved: boolean } | null
}

const boot = (options: BootOptions = {}) => {
  const editorState = reactive<{ currentFile: { isSaved: boolean } | null }>({
    currentFile: options.currentFile ?? null
  })
  const titleBarStyle = ref('custom')
  const showTabBar = ref(true)

  ;(globalThis as unknown as { window: unknown }).window = {
    electron: {
      windowControl: {},
      ipcRenderer: {
        on: () => () => {}
      }
    }
  }

  const deps = {
    _defineComponent: (o: unknown) => o,
    usePreferencesStore: () => ({}),
    useLayoutStore: () => ({}),
    useEditorStore: () => editorState,
    ref,
    computed,
    watch,
    onMounted: () => {},
    onBeforeUnmount: () => {},
    storeToRefs: () => ({ titleBarStyle, showTabBar }),
    // #GUI-B8 gave titleBar/index.vue `useI18n` (aria-labels) and
    // `activateOnEnterOrSpace`. Both are destructured out of __deps by the
    // harness, so each needs an entry here — this one is not optional at
    // setup time: the component calls useI18n() during setup, so a missing
    // binding fails all five cases with a ReferenceError rather than
    // silently drifting.
    useI18n: () => ({ t: (k: string) => k }),
    minimizePath: 'min',
    restorePath: 'restore',
    maximizePath: 'max',
    closePath: 'close',
    isOsxPlatform: false,
    shouldShowInAppTitleBar: () => true,
    // Stubbed, not imported: #GUI-B8 adds `activateOnEnterOrSpace` to
    // titleBar/index.vue's imports, and this harness destructures exactly the
    // keys listed here out of __deps — an unlisted binding is a ReferenceError
    // that only fires on the render path, so it would sit undetected until
    // B1 and B8 meet in develop.
    activateOnEnterOrSpace: () => {}
  }

  const setup = loadSfcSetup<Record<string, unknown>>(vuePath, deps)
  setup({ filename: options.filename, project: options.project ?? undefined }, { expose: () => {} })
  return { editorState }
}

describe('title bar: document.title mirrors the unsaved state', () => {
  it('marks the title dirty while the current file is unsaved', async () => {
    const { editorState } = boot({ filename: 'a.md' })

    editorState.currentFile = { isSaved: false }
    await nextTick()
    expect(document.title).toBe('● a.md')
  })

  it('clears the marker when the file is saved, without a filename change', async () => {
    const { editorState } = boot({ filename: 'a.md', currentFile: { isSaved: false } })
    expect(document.title).toBe('● a.md')

    editorState.currentFile = { isSaved: true }
    await nextTick()
    expect(document.title).toBe('a.md')
  })

  it('applies on setup, so a dirty restored session does not start clean', () => {
    boot({ filename: 'a.md', currentFile: { isSaved: false } })
    expect(document.title).toBe('● a.md')
  })

  it('keeps the project suffix after the marker', () => {
    boot({
      filename: 'a.md',
      project: { name: 'notes' },
      currentFile: { isSaved: false }
    })
    expect(document.title).toBe('● a.md - notes')
  })

  it('falls back to the brand default for the empty-launch state', () => {
    // The watch is immediate, so it runs before any file exists — wiping the
    // index.html default would blank the taskbar title (and broke the launch
    // e2e expectation). A dirty untitled state must not show a bare `● `.
    boot({ filename: undefined, currentFile: { isSaved: false } })
    expect(document.title).toBe('ColaMD')
  })

  it('shows the folder name when a folder is open but no file', () => {
    // VS Code-style: the taskbar names the open folder until a file takes
    // over. The launch e2e pins the same behavior against the real app.
    boot({ filename: undefined, project: { name: 'desktop' } })
    expect(document.title).toBe('desktop')
  })
})
