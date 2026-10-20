// Dynamic-channel ledger: the machine-readable registry behind
// dynamic-channel-ledger.spec.ts. ESLint §11 (root eslint.config.js) bans bare
// `ipcMain.handle/on` and `X.webContents.send` in src/main so every channel
// stays checked against shared/types/ipc.ts; the ban is enforced with
// `eslint-disable-next-line no-restricted-syntax` comments at the few sites
// that legitimately need it. This ledger registers every one of those sites
// (file + the code line the disable applies to — identity travels with the
// code, line numbers drift) and the spec keeps the list and its count honest.
//
// Batch note (2026-10-20): the batch that seeded this ledger collapsed all
// three runtime-built channel families the rule used to exempt:
//
//   1. `mt::response-of-image-path-${id}` (edit.ts ×5) — a per-request reply
//      address. The correlation id now rides in the payload of the single
//      static `mt::response-of-image-path` channel, the same shape
//      `mt::response-file-move-to` already used; the renderer keeps a pending
//      map instead of a per-request `once` listener.
//   2. `mt::window-${channel}` (editor.ts) — a four-value lookup table over
//      `mt::window-{maximize,unmaximize,enter-full-screen,leave-full-screen}`,
//      all declared `[]` in the contract, so the union key is checkable.
//   3. `EVENT_NAME[type]` (watcher.ts ×2) — the two watcher channels turned
//      out to carry the identical FileChangeDetail payload;
//      `mt::update-object-tree` was declared `unknown`, which is what made the
//      union uncheckable. Typing it for real (the renderer consumer already
//      cast the payload to exactly that shape) made the lookup checkable.
//
// What remains is the machinery itself — the wrappers the rule points at, and
// the in-process event bus — plus a repo-wide ban on building channel names at
// runtime, both verified by the spec.

export interface ChannelExemption {
  /** Repo-root relative file carrying the eslint-disable comment. */
  file: string
  /** The code line the disable applies to, trimmed. */
  site: string
  /** How many times this file+site pair occurs (identical sites merge). */
  count: number
  /** Why this bare IPC call is legitimate. */
  reason: string
}

export const channelExemptions: ChannelExemption[] = [
  {
    file: 'packages/desktop/src/main/ipc/typedHandle.ts',
    site: 'ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)',
    count: 1,
    reason:
      'this is the wrapper the rule points at — registering through typedHandle IS the checked path'
  },
  {
    file: 'packages/desktop/src/main/ipc/typedOn.ts',
    site: 'ipcMain.on(channel, listener as (event: IpcMainEvent, ...args: unknown[]) => void)',
    count: 2,
    reason:
      'this is the wrapper the rule points at — typedOn and typedSyncOn both register through it; the sync variant keeps the ban free of exceptions by having its own wrapper instead of an exemption'
  },
  {
    file: 'packages/desktop/src/main/utils/internalIpc.ts',
    site: 'ipcMain.on(channel, listener as unknown as (event: IpcMainEvent, ...args: unknown[]) => void)',
    count: 1,
    reason:
      'in-process event bus dispatched via ipcMain.emit — the channel is a runtime string by design and no renderer contract applies; the signature adaptation is contained here so callers keep real payload types'
  }
]

/** Ratchet baseline: remaining no-restricted-syntax exemptions under
 *  ESLint §11, seeded 2026-10-20 at 4 after the three dynamic-channel
 *  families were collapsed into the contract. This number may only shrink —
 *  a new exemption means a channel escaped the contract and must be pulled
 *  back in (or, for genuinely internal buses, registered here with a reason). */
export const EXEMPTION_BASELINE = 4
