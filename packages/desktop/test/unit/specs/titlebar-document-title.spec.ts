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
    minimizePath: 'min',
    restorePath: 'restore',
    maximizePath: 'max',
    closePath: 'close',
    isOsxPlatform: false,
    shouldShowInAppTitleBar: () => true
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

  it('never shows a bare marker without a title', () => {
    // Dirty untitled state: `● ` alone in the taskbar would be noise.
    boot({ filename: undefined, currentFile: { isSaved: false } })
    expect(document.title).toBe('')
  })
})
