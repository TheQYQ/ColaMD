import type { BootstrapEditorConfig } from '@shared/types/files'

// PERF-01 (#GUI-B5): the editor route component is a lazy chunk now, so the
// main process's `mt::bootstrap-editor` (sent right around did-finish-load)
// can arrive BEFORE app.vue mounted and registered the store listener — and
// Electron does not replay IPC. This module registers its listener at its own
// module evaluation, which happens while the entry chunk executes and is
// therefore guaranteed to precede did-finish-load. The buffered configs are
// drained by `LISTEN_FOR_BOOTSTRAP_WINDOW` once the stores exist.

const buffer: BootstrapEditorConfig[] = []

if (!window.electron?.ipcRenderer) {
  // Tests import this module with the preload surface stubbed differently;
  // registration is meaningless without the bridge.
} else {
  window.electron.ipcRenderer.on('mt::bootstrap-editor', (_e, config) => {
    buffer.push(config as BootstrapEditorConfig)
  })
}

/** Take (and clear) every bootstrap config that arrived before mounting. */
export const takePendingBootstrapEditors = (): BootstrapEditorConfig[] => buffer.splice(0)
