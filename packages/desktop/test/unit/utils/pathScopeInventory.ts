// Path-scope coverage inventory: the policy ledger the coverage spec enforces.
// Every renderer-reachable channel is classified exactly once; grant/assert
// call sites are listed as file+snippet multisets; known gaps form a ratchet
// ledger that may only shrink (a fixed gap must move class when its gate
// lands — the assert-site ledger update forces that flip).
//
// Ratchet rules:
//   - adding a new registered channel requires classifying it here
//   - adding a new addAllowedRoot/assertPathInScope call site requires
//     listing it here (and grant sites must live in grantSiteFiles)
//   - fixing a known-gap channel means adding its gate, updating the
//     call-site ledger, and changing its class — never silently

export type ChannelClass =
  | { class: 'gated'; note?: string }
  | { class: 'intentional-probe'; reason: string }
  | { class: 'known-gap'; issue: string }
  | { class: 'internal'; note?: string }
  | { class: 'non-path'; note?: string }

export interface LedgerSite {
  file: string
  snippet: string
}

/**
 * Channel name → classification. Must cover every scanned registration.
 *
 * Classes:
 *   gated             — renderer-supplied path params go through
 *                       assertPathInScope or an equivalent documented gate
 *   intentional-probe — open by decision; reason quotes the in-repo rationale
 *   known-gap         — reviewed hole; ratchet ledger, must only shrink
 *   internal          — onInternalChannel listener (in-process by design);
 *                       still misalignment-exposed to renderer sends
 *   non-path          — no renderer-supplied filesystem path in the handler
 */
export const channelClasses: Record<string, ChannelClass> = {
  // --- known gaps (2026-10 review; fix batches shrink this list) -----------
  // Empty since batch C (seeded 9 → batch A 7 → batch B 4 → batch C 0); the
  // ratchet in path-scope-coverage.spec.ts keeps it from growing again.

  // --- gated ---------------------------------------------------------------
  'app-open-directory-by-id': {
    class: 'gated',
    note: 'batch C: assertPathInScope(pathname) in the handler (app/index.ts); refusal logs, no toast — mirrors app-open-file-by-id; sole legit emitter (file.ts openFileOrFolder) grants the root before emitting'
  },
  'app-open-files-by-id': {
    class: 'gated',
    note: 'batch C: Array.isArray normalization + assertPathInScope per path in the handler (app/index.ts); refusal logs — paired with the File > Open dialog grant in file.ts openFile'
  },
  'menu-add-recently-used': {
    class: 'gated',
    note: 'batch D: assertPathInScope(pathname) in the handler (menu/index.ts), refusal logs; removed from IpcSendChannels so no typed renderer path remains — legit emitters are save flows (file.ts:329/498) whose target passed scope or a dialog grant first'
  },
  'mt::ask-for-image-auto-path': {
    class: 'gated',
    note: 'batch C: pathname type check + assertPathInScope(dir) in the handler (menu/actions/edit.ts); refusal logs and replies []'
  },
  'mt::format-link-click': {
    class: 'gated',
    note: 'batch C: assertPathInScope(pathname) after decode/normalize, before both exits (menu/actions/file.ts); refusal logs and notifies dialog.openRefused — covers openFileOrFolder (document-controlled grant) and shell.openPath'
  },
  'mt::fs::read-file': { class: 'gated' },
  'mt::open-file': {
    class: 'gated',
    note: 'batch B: assertPathInScope in the handler (windowManager.ts mt::open-file); refusal logs and notifies dialog.openRefused'
  },
  'mt::menu::open-path': {
    class: 'gated',
    note: 'batch B: membership in main-owned recently-used-documents list before openFileOrFolder (ipc/menu.ts); equivalent documented gate — cross-session recents sit outside the current pathScope roots by design; residual closed by batch D — the add channel now asserts pathScope and left IpcSendChannels'
  },
  'mt::window::drop': {
    class: 'gated',
    note: 'batch B: preload trust anchor — page-facing send refuses the channel and the preload drop listener (src/preload/dropBridge.ts) is the only sender; webUtils.getPathForFile yields "" for JS-built Files, so a forged DragEvent produces no message (spike 2026-10-06); main handler openFileOrFolder unchanged'
  },
  'mt::fs::readdir': { class: 'gated' },
  'mt::fs::copy': { class: 'gated' },
  'mt::fs::move': { class: 'gated' },
  'mt::fs::unlink': { class: 'gated' },
  'mt::fs::write-file': { class: 'gated' },
  'mt::fs::output-file': { class: 'gated' },
  'mt::fs::ensure-dir': { class: 'gated' },
  'mt::fs-trash-item': { class: 'gated' },
  'mt::rg::start': { class: 'gated' },
  'mt::uploader::upload': { class: 'gated' },
  'mt::shell::open-external': {
    class: 'gated',
    note: 'URL scheme whitelist via openExternalSafe (shell.ts:16), not pathScope'
  },
  'mt::shell::show-item': { class: 'gated' },
  'mt::shell::open-path': { class: 'gated' },
  'mt::open-file-by-window-id': { class: 'gated' },
  'mt::response-file-save': {
    class: 'gated',
    note: 'assertPathInScope on overwrite (file.ts:307); new-file target comes from main-side dialog'
  },
  'mt::response-file-move-to': { class: 'gated' },
  'mt::rename': {
    class: 'gated',
    note: 'batch A: asserts both renderer-supplied ends, source and target (file.ts rename handler); target may not exist yet — assertPathInScope accepts that'
  },
  'mt::set-user-data': {
    class: 'gated',
    note: 'batch A: key allow-list (only currentUploader is renderer-owned); imageFolderPath/screenshotFolderPath stay dialog-assigned (dataCenter/index.ts set-user-data handler)'
  },
  'mt::set-user-preference': {
    class: 'gated',
    note: 'key filter drops imageFolderPath/screenshotFolderPath (preferences/index.ts:229), not assertPathInScope'
  },

  // --- intentional probes / documented exclusions --------------------------
  'mt::fs::is-file': {
    class: 'intentional-probe',
    reason: 'boolean existence probe open by decision — pathScope.ts:27-31, ipc/fs.ts:47'
  },
  'mt::fs::is-directory': {
    class: 'intentional-probe',
    reason: 'boolean existence probe open by decision — pathScope.ts:27-31, ipc/fs.ts:48'
  },
  'mt::fs::path-exists': {
    class: 'intentional-probe',
    reason: 'boolean existence probe open by decision — pathScope.ts:27-31, ipc/fs.ts:49'
  },
  'mt::fs::is-executable': {
    class: 'intentional-probe',
    reason: 'boolean existence probe open by decision — pathScope.ts:27-31, ipc/fs.ts:80'
  },
  'mt::paths::is-image': {
    class: 'intentional-probe',
    reason: 'boolean probe listed in pathScope.ts:30-31'
  },
  'mt::version-history:list': {
    class: 'intentional-probe',
    reason: 'pathname is a sha1 store key, never a filesystem path — versionHistory/index.ts:47-52'
  },
  'mt::version-history:get-content': {
    class: 'intentional-probe',
    reason:
      'pathname is a sha1 store key; bytes previously entered via same renderer — versionHistory/index.ts:47-52'
  },
  'mt::version-history:delete': {
    class: 'intentional-probe',
    reason: 'pathname is a sha1 store key — versionHistory/index.ts:47-52'
  },
  'mt::version-history:clear': {
    class: 'intentional-probe',
    reason: 'pathname is a sha1 store key — versionHistory/index.ts:47-52'
  },
  'mt::version-history:save': {
    class: 'intentional-probe',
    reason: 'snapshot keyed by hashed pathname inside userData — versionHistory/index.ts:21-26'
  },

  // --- internal (onInternalChannel) ----------------------------------------
  'app-open-file-by-id': {
    class: 'internal',
    note: 'has assertPathInScope (app/index.ts:761); still in accidentalReachability via IpcSendChannels'
  },
  'app-open-markdown-by-id': {
    class: 'internal',
    note: 'markdown payload, no filesystem path; in accidentalReachability'
  },
  'app-create-settings-window': { class: 'internal', note: 'in accidentalReachability' },
  'broadcast-preferences-changed': {
    class: 'internal',
    note: 'preference payloads only; in accidentalReachability'
  },
  'broadcast-user-data-changed': {
    class: 'internal',
    note: 'grant listener for imageFolderPath (app/index.ts:370) — safe because mt::set-user-data filters keys (gated since batch A)'
  },
  'screen-capture': { class: 'internal', note: 'in accidentalReachability' },
  'set-user-preference': {
    class: 'internal',
    note: 'same key filter as mt::set-user-preference twin; in accidentalReachability'
  },
  'watcher-unwatch-all-by-id': { class: 'internal', note: 'in accidentalReachability' },
  'watcher-unwatch-directory': { class: 'internal', note: 'in accidentalReachability' },
  'watcher-unwatch-file': { class: 'internal', note: 'in accidentalReachability' },
  'watcher-watch-directory': {
    class: 'internal',
    note: 'renderer-supplied watch path, misalignment-exposed; in accidentalReachability'
  },
  'watcher-watch-file': {
    class: 'internal',
    note: 'renderer-supplied watch path, misalignment-exposed; in accidentalReachability'
  },
  'window-add-file-path': { class: 'internal', note: 'in accidentalReachability' },
  'window-change-file-path': { class: 'internal', note: 'in accidentalReachability' },
  'window-close-by-id': { class: 'internal', note: 'in accidentalReachability' },
  'window-file-saved': { class: 'internal', note: 'in accidentalReachability' },
  'window-reload-by-id': { class: 'internal', note: 'in accidentalReachability' },
  'window-toggle-always-on-top': { class: 'internal', note: 'in accidentalReachability' },

  // --- non-path ------------------------------------------------------------
  'app-create-editor-window': { class: 'non-path' },
  'menu-clear-recently-used': { class: 'non-path' },
  'mt::NEED_UPDATE': { class: 'non-path' },
  'mt::app-try-quit': { class: 'non-path' },
  'mt::ask-for-image-path': { class: 'non-path', note: 'main-side file dialog assigns the path' },
  'mt::ask-for-modify-cli-script': { class: 'non-path', note: 'main-side dialog assigns the path' },
  'mt::ask-for-modify-image-folder-path': {
    class: 'non-path',
    note: 'no args; dialog result is the only imageFolderPath assigner (trusted grant flow)'
  },
  'mt::ask-for-open-file-in-sidebar': { class: 'non-path', note: 'opens main-side dialog' },
  'mt::ask-for-user-data': { class: 'non-path' },
  'mt::ask-for-user-preference': { class: 'non-path' },
  'mt::check-for-update': { class: 'non-path' },
  'mt::clipboard::guess-file-path': { class: 'non-path', note: 'reads OS clipboard, not disk' },
  'mt::clipboard::read-text': { class: 'non-path' },
  'mt::clipboard::write-text': { class: 'non-path' },
  'mt::close-window': { class: 'non-path' },
  'mt::close-window-confirm': { class: 'non-path' },
  'mt::cmd-close-window': { class: 'non-path' },
  'mt::cmd-import-file': { class: 'non-path', note: 'triggers main-side dialog' },
  'mt::cmd-new-editor-window': { class: 'non-path' },
  'mt::cmd-open-file': { class: 'non-path', note: 'triggers main-side dialog' },
  'mt::cmd-open-folder': { class: 'non-path', note: 'triggers main-side dialog' },
  'mt::cmd-toggle-autosave': { class: 'non-path' },
  'mt::cmd::exists': { class: 'non-path' },
  'mt::dialog::error-box': { class: 'non-path' },
  'mt::dialog::message-box': { class: 'non-path' },
  'mt::dialog::open': {
    class: 'non-path',
    note: 'native dialog result grants roots (ipc/dialog.ts:37)'
  },
  'mt::dialog::save': { class: 'non-path', note: 'native dialog result is the write target' },
  'mt::editor-selection-changed': { class: 'non-path' },
  'mt::fonts::list': { class: 'non-path' },
  'mt::get-current-language': { class: 'non-path' },
  'mt::handle-renderer-error': { class: 'non-path' },
  'mt::i18n::load': { class: 'non-path' },
  'mt::keybinding-debug-dump-keyboard-info': { class: 'non-path' },
  'mt::keybinding-get-keyboard-info': { class: 'non-path' },
  'mt::keybinding-get-pref-keybindings': { class: 'non-path' },
  'mt::keybinding-save-user-keybindings': { class: 'non-path' },
  'mt::make-screenshot': { class: 'non-path' },
  'mt::menu::get-recent-documents': {
    class: 'non-path',
    note: 'returns recents the UI already shows'
  },
  'mt::menu::native-clipboard': { class: 'non-path' },
  'mt::menu::popup': { class: 'non-path' },
  'mt::open-setting-window': { class: 'non-path' },
  'mt::request-keybindings': { class: 'non-path' },
  'mt::response-export': { class: 'non-path', note: 'export target from main-side dialog' },
  'mt::response-print': { class: 'non-path' },
  'mt::response-file-save-as': {
    class: 'non-path',
    note: 'write target assigned by main-side save dialog (file.ts:487); renderer pathname is only the dialog default hint'
  },
  'mt::rg::cancel': { class: 'non-path' },
  'mt::save-and-close-tabs': {
    class: 'non-path',
    note: 'orchestrates save flows that gate their own paths'
  },
  'mt::save-tabs': { class: 'non-path', note: 'orchestrates save flows that gate their own paths' },
  'mt::select-default-directory-to-open': { class: 'non-path', note: 'opens main-side dialog' },
  'mt::set-editor-format-menus-enabled': { class: 'non-path' },
  'mt::spellchecker-get-available-dictionaries': { class: 'non-path' },
  'mt::spellchecker-get-custom-dictionary-words': { class: 'non-path' },
  'mt::spellchecker-remove-word': { class: 'non-path' },
  'mt::spellchecker-set-enabled': { class: 'non-path' },
  'mt::spellchecker-switch-language': { class: 'non-path' },
  'mt::unsaved-dialog-response': { class: 'non-path' },
  'mt::update-format-menu': { class: 'non-path' },
  'mt::update-line-ending-menu': { class: 'non-path' },
  'mt::update-sidebar-menu': { class: 'non-path' },
  'mt::view-layout-changed': { class: 'non-path' },
  'mt::win::close': { class: 'non-path' },
  'mt::win::is-fullscreen': { class: 'non-path' },
  'mt::win::is-maximized': { class: 'non-path' },
  'mt::win::maximize': { class: 'non-path' },
  'mt::win::minimize': { class: 'non-path' },
  'mt::win::set-fullscreen': { class: 'non-path' },
  'mt::win::toggle-fullscreen': { class: 'non-path' },
  'mt::win::unmaximize': { class: 'non-path' },
  'mt::window-tab-closed': { class: 'non-path', note: 'tab bookkeeping, no fs access' },
  'mt::window-toggle-always-on-top': { class: 'non-path' },
  'update-buffer-state': { class: 'non-path' }
}

/** Multiset of assertPathInScope call sites (file + normalized call text). */
export const assertSites: LedgerSite[] = [
  { file: 'src/main/app/index.ts', snippet: 'assertPathInScope(filePath)' },
  { file: 'src/main/app/index.ts', snippet: 'assertPathInScope(fullPath)' },
  { file: 'src/main/app/index.ts', snippet: 'assertPathInScope(pathname)' },
  { file: 'src/main/app/index.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/app/index.ts', snippet: 'assertPathInScope(resolvedPath)' },
  { file: 'src/main/app/windowManager.ts', snippet: 'assertPathInScope(filePath)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(dest)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(dest)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(src)' },
  { file: 'src/main/ipc/fs.ts', snippet: 'assertPathInScope(src)' },
  { file: 'src/main/ipc/ripgrep.ts', snippet: 'assertPathInScope(dir)' },
  { file: 'src/main/ipc/shell.ts', snippet: 'assertPathInScope(fullPath)' },
  { file: 'src/main/ipc/shell.ts', snippet: 'assertPathInScope(fullPath)' },
  { file: 'src/main/ipc/uploader.ts', snippet: 'assertPathInScope(imagePath)' },
  { file: 'src/main/menu/actions/edit.ts', snippet: 'assertPathInScope(dir)' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'assertPathInScope(filePath)' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'assertPathInScope(newPathname)' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'assertPathInScope(pathname)' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'assertPathInScope(pathname)' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'assertPathInScope(pathname)' },
  { file: 'src/main/menu/index.ts', snippet: 'assertPathInScope(pathname)' }
]

/** Multiset of addAllowedRoot call sites (file + normalized call text). */
export const grantSites: LedgerSite[] = [
  { file: 'src/main/app/index.ts', snippet: "addAllowedRoot(app.getPath('userData'))" },
  { file: 'src/main/app/index.ts', snippet: 'addAllowedRoot(dir)' },
  { file: 'src/main/app/index.ts', snippet: 'addAllowedRoot(folder)' },
  { file: 'src/main/app/index.ts', snippet: 'addAllowedRoot(imageFolderPath)' },
  { file: 'src/main/app/index.ts', snippet: 'addAllowedRoot(path.dirname(file))' },
  {
    file: 'src/main/ipc/dialog.ts',
    snippet: 'addAllowedRoot(isDirectory(picked)?picked:path.dirname(picked))'
  },
  {
    file: 'src/main/menu/actions/file.ts',
    snippet: 'addAllowedRoot(path.dirname(normalizeAndResolvePath(picked)))'
  },
  { file: 'src/main/menu/actions/file.ts', snippet: 'addAllowedRoot(path.dirname(resolvedPath))' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'addAllowedRoot(path.dirname(resolvedPath))' },
  { file: 'src/main/menu/actions/file.ts', snippet: 'addAllowedRoot(resolvedPath)' },
  { file: 'src/main/windows/editor.ts', snippet: 'addAllowedRoot(path.dirname(filePath))' },
  { file: 'src/main/windows/editor.ts', snippet: 'addAllowedRoot(path.dirname(tab.pathname))' },
  { file: 'src/main/windows/editor.ts', snippet: 'addAllowedRoot(rootDirectory)' },
  { file: 'src/main/windows/editor.ts', snippet: 'addAllowedRoot(rootDirectory)' }
]

/**
 * Files allowed to call addAllowedRoot — provably-trusted grant flows only
 * (pathScope.ts:36-38): startup bootstrap, native dialogs, argv/menu open
 * flows. A grant site in any other file fails the coverage spec.
 */
export const grantSiteFiles: string[] = [
  'src/main/app/index.ts',
  'src/main/ipc/dialog.ts',
  'src/main/menu/actions/file.ts',
  'src/main/windows/editor.ts'
]

/**
 * Channels that appear both as onInternalChannel listeners and in
 * IpcSendChannels — renderer-sendable with a misaligned listener signature
 * (internalIpc.ts:4-13). Both directions are enforced: the list must equal
 * the scanned intersection. Shrinking it requires moving the channel out of
 * IpcSendChannels or off onInternalChannel.
 */
export const accidentalReachability: string[] = [
  'app-create-settings-window',
  'app-open-directory-by-id',
  'app-open-file-by-id',
  'app-open-files-by-id',
  'app-open-markdown-by-id',
  'broadcast-preferences-changed',
  'broadcast-user-data-changed',
  'screen-capture',
  'set-user-preference',
  'watcher-unwatch-all-by-id',
  'watcher-unwatch-directory',
  'watcher-unwatch-file',
  'watcher-watch-directory',
  'watcher-watch-file',
  'window-add-file-path',
  'window-change-file-path',
  'window-close-by-id',
  'window-file-saved',
  'window-reload-by-id',
  'window-toggle-always-on-top'
]
