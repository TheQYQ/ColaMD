// IPC unknown-payload ledger: every `unknown` left in the contract
// (shared/types/ipc.ts), registered with a reason. The spec
// (ipc-unknown-ledger.spec.ts) extracts the real sites from the contract
// source and requires an exact match, so a new `unknown` anywhere in the file
// fails the suite by locator — and the total may only shrink.
//
// Pattern follows pathScopeInventory / preferencesParityLedger: known debt is
// ledgered with a reason and ratcheted down, never silently grown. The
// contract header points here; the ipc.ts header comment points at the spec.
//
// Batch 1 (2026-10-20) tightened 11 sites and lowered the baseline 35 → 24:
// the five `mt::rg::*` events (new exported envelopes in
// shared/types/ripgrep.ts), the four `mt::UPDATE_*` events (they carry a
// message string, not electron-updater's UpdateInfo the old shape implied),
// `mt::keybindings-response` (a plain Record) and `mt::set-view-layout`
// (ViewLayoutPartial, now contract-owned). Wiring the emit sites immediately
// caught one latent bug: a malformed ripgrep stream ('end' without 'begin')
// used to push a null match payload to the renderer.
//
// Batch 2 (2026-10-20, the dynamic-channel batch) typed the last big one:
// `mt::update-object-tree` now declares the real tree-event payload
// (`{ type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; change:
// FileChangeDetail }` — the same FileChangeDetail `mt::update-file` already
// used). The renderer's consumer had cast the payload to exactly that shape,
// so the `unknown` was pure debt; the tree total drops to 23 and the baseline
// was lowered 24 → 23 in the same change.

export interface IpcUnknownSite {
  /** Channel name, or the payload interface name for nested declarations. */
  locator: string
  /** How many `unknown` tokens the site declares. */
  count: number
  /** Why it is still open, and what tightening it would take. */
  reason: string
}

export const ipcUnknownSites: IpcUnknownSite[] = [
  // --- invoke channels ------------------------------------------------------
  {
    locator: 'mt::i18n::load',
    count: 1,
    reason:
      'translation JSON is arbitrarily nested objects/arrays; a typed schema belongs with the locale files'
  },
  {
    locator: 'mt::uploader::upload',
    count: 1,
    reason:
      'the uploader result is polymorphic per uploader backend (picgo et al.); needs a result union first'
  },
  {
    locator: 'update-buffer-state',
    count: 1,
    reason:
      'payload is BufferedState, deliberately open for forward-compatible persisted state; tightening belongs with a bufferedState schema pass'
  },
  // --- send channels --------------------------------------------------------
  {
    locator: 'app-create-editor-window',
    count: 1,
    reason: 'window config varies by entry point (CLI args, open paths, dev flags)'
  },
  {
    locator: 'app-open-file-by-id',
    count: 1,
    reason: 'open options bag (line/column, new-window flags) varies by caller'
  },
  {
    locator: 'app-open-files-by-id',
    count: 1,
    reason: 'same options bag as app-open-file-by-id'
  },
  {
    locator: 'app-open-markdown-by-id',
    count: 1,
    reason: 'same options bag as app-open-file-by-id'
  },
  {
    locator: 'broadcast-preferences-changed',
    count: 1,
    reason:
      'arbitrary preference subset; the preference contract itself is dynamic (see preferencesParityLedger)'
  },
  {
    locator: 'broadcast-user-data-changed',
    count: 1,
    reason: 'user data is a dynamic bag owned by DataCenter'
  },
  {
    locator: 'mt::open-file',
    count: 1,
    reason: 'dialog-driven open options; shape follows the picker result'
  },
  {
    locator: 'mt::open-file-by-window-id',
    count: 1,
    reason: 'same options bag as app-open-file-by-id'
  },
  {
    locator: 'mt::rename',
    count: 1,
    reason: 'the whole current tab state (currentFile) rides along for the rename flow'
  },
  {
    locator: 'mt::set-user-data',
    count: 1,
    reason: 'dynamic user-data bag, same owner as broadcast-user-data-changed'
  },
  {
    locator: 'mt::set-user-preference',
    count: 1,
    reason: 'dynamic preference bag, same owner as broadcast-preferences-changed'
  },
  {
    locator: 'mt::view-layout-changed',
    count: 1,
    reason:
      'a third caller (preferences DISPATCH_EDITOR_VIEW_STATE) passes an arbitrary preference-derived record; shape that caller first, then reuse ViewLayoutPartial'
  },
  {
    locator: 'screen-capture',
    count: 1,
    reason: 'internal screenshot bridge payload'
  },
  {
    locator: 'set-user-preference',
    count: 1,
    reason:
      'legacy non-mt:: alias of the preference bag; retire the alias or type it with mt::set-user-preference'
  },
  {
    locator: 'mt::pandoc-not-exists',
    count: 1,
    reason: 'pandoc export options bag, built by the export settings dialog'
  },
  // --- push events ----------------------------------------------------------
  {
    locator: 'mt::show-notification',
    count: 1,
    reason: 'notification options bag; the notice service accepts a wide shape'
  },
  {
    locator: 'mt::spelling-replace-misspelling',
    count: 1,
    reason:
      'spellcheck replace payload (word/replacement); small, tighten with the spellchecker pass'
  },
  {
    locator: 'mt::user-preference',
    count: 1,
    reason: 'preference broadcast bag, same owner as broadcast-preferences-changed'
  },
  // --- nested payload interfaces --------------------------------------------
  {
    locator: 'ImageAutoPathRequest',
    count: 1,
    reason: 'currentFile is the whole tab state, carried for image path resolution'
  },
  {
    locator: 'FormatLinkPayload',
    count: 1,
    reason:
      'deliberate escape hatch: the muya getLinkInfo object is forwarded wholesale, so data keeps an index signature'
  }
]

/** Ratchet baseline: the number of `unknown` tokens in the contract after
 *  batch 2 (2026-10-20). Seeded at 35 when the ledger was created; batch 1
 *  tightened 11 sites and lowered it to 24; batch 2 typed
 *  `mt::update-object-tree` and lowered it to 23. Fixing a site means
 *  deleting its entry here AND lowering this number in the same change —
 *  never raising it. */
export const IPC_UNKNOWN_BASELINE = 23
