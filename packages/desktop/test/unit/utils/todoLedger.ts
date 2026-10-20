// TODO/FIXME/HACK ledger: every debt marker left in the two packages' `src`
// trees, registered with a reason. todo-ledger.spec.ts extracts the real
// sites from the sources and requires an exact match, so a new marker
// anywhere in scope fails the suite by file+text — and the total may only
// shrink (remove a marker → delete its entry → lower the baseline).
//
// Pattern follows pathScopeInventory / preferencesParityLedger /
// ipcUnknownLedger: known debt is ledgered with a reason and ratcheted down,
// never silently grown.
//
// Counting 口径 (lives here and in the spec, not only in the docs):
//   - markers: TODO / FIXME / HACK (word-boundary matches, every token)
//   - scope:   packages/desktop/src and packages/muya/src (tests inside
//              muya's src count too; build output does not)
//   - a site is keyed by (file, exact comment text from the marker to the
//     end of the line); repeated identical texts collapse into `count`
//   - vendored code is excluded — see EXCLUDED below
//
// Provenance: PROJECT_GUIDE §13 measured 55 under this 口径 on 2026-09-26
// (TODO/FIXME/HACK, vendored excluded). The tree now carries 51: four
// markers disappeared with later batches (none of them this fork added —
// every remaining site is inherited from upstream MarkText or the muya
// engine, which is itself worth knowing).

export interface TodoSite {
  /** Repo-root-relative file the marker sits in. */
  file: string
  /** Exact marker text, from the keyword to the end of the line. */
  text: string
  /** How many times this exact text appears in the file. */
  count: number
  /** Why it is still open, and who it came from. */
  reason: string
}

/** Files excluded from the count, with the reason. The spec asserts this
 *  list stays excluded: un-ignoring one of these is a conscious act. */
export const EXCLUDED: { file: string; reason: string }[] = [
  {
    file: 'packages/muya/src/utils/diagram/sequence/sequence-diagram-snap.js',
    reason:
      'vendored snap.svg diagram library (14 TODO + 1 HACK upstream); not ours to ratchet, tracked by the vendoring note instead'
  }
]

export const todoSites: TodoSite[] = [
  // --- desktop: main process (all inherited from upstream MarkText) -------
  {
    file: 'packages/desktop/src/main/app/index.ts',
    text: "TODO: Do nothing, maybe we'll add screenCapture later on Linux and Windows.",
    count: 1,
    reason:
      'upstream MarkText: screen capture deliberately unimplemented off macOS; product decision, no issue filed'
  },
  {
    file: 'packages/desktop/src/main/app/paths.ts',
    text: 'TODO(sessions): enable this...',
    count: 1,
    reason:
      'upstream MarkText: session-restore path resolution left disabled; the sessions feature is not ported'
  },
  {
    file: 'packages/desktop/src/main/app/windowManager.ts',
    text: 'TODO(need::refactor): Please see #1035.',
    count: 1,
    reason:
      'upstream MarkText #1035 (window-manager refactor); blocked on the same redesign as the watcher'
  },
  {
    file: 'packages/desktop/src/main/filesystem/markdown.ts',
    text: 'TODO: Use streams to not buffer the file multiple times and only guess',
    count: 1,
    reason:
      'upstream MarkText: encoding detection buffers the whole file; a streaming rewrite is perf work, no correctness impact'
  },
  {
    file: 'packages/desktop/src/main/filesystem/watcher.ts',
    text: 'TODO(refactor): Please see GH#1035.',
    count: 1,
    reason: 'upstream MarkText #1035 (watcher redesign)'
  },
  {
    file: 'packages/desktop/src/main/filesystem/watcher.ts',
    text: 'HACK: But this should be removed completely in #1034/#1035.',
    count: 1,
    reason:
      'upstream MarkText #1034/#1035: the HACK disappears together with the watcher redesign above'
  },
  {
    file: 'packages/desktop/src/main/menu/actions/colamd.ts',
    text: 'TODO: We should ask the user, so that the user can save all documents and',
    count: 1,
    reason:
      'upstream MarkText: a save-all prompt on quit is a product decision; current flow asks per document'
  },
  {
    file: 'packages/desktop/src/main/menu/actions/edit.ts',
    text: 'TODO(Refactor): Move to filesystem and provide generic API to search files in directories.',
    count: 1,
    reason:
      'upstream MarkText: directory search belongs in the filesystem layer once a generic API exists'
  },
  {
    file: 'packages/desktop/src/main/menu/actions/file.ts',
    text: 'TODO(refactor): "save" and "save as" should be moved to the editor window (editor.js) and',
    count: 1,
    reason:
      'upstream MarkText: save handlers belong in the editor window after the main/renderer split settles'
  },
  {
    file: 'packages/desktop/src/main/menu/templates/edit.ts',
    text: 'TODO: Remove this menu entry and add it to the command palette (#1408).',
    count: 1,
    reason:
      'upstream MarkText #1408: entry superseded by the command palette; removal must update the menu-template golden spec'
  },
  {
    file: 'packages/desktop/src/main/menu/templates/help.ts',
    text: 'TODO: If not updatable, allow to check whether there is a new version available.',
    count: 1,
    reason: 'upstream MarkText: manual update check for non-updatable builds'
  },
  {
    file: 'packages/desktop/src/main/preferences/index.ts',
    text: "TODO(fxha): For performance reasons, we should try to replace 'electron-store' because",
    count: 1,
    reason:
      'upstream MarkText (fxha): electron-store performance; replacing the store is a migration project, not a drive-by'
  },
  {
    file: 'packages/desktop/src/main/utils/imagePathAutoComplement.ts',
    text: 'TODO(need::refactor): Refactor this file. Just return an array of directories and files without caching and watching?',
    count: 1,
    reason:
      'upstream MarkText: the cache+watch design predates the tree store; rewrite as a plain directory scan'
  },
  {
    file: 'packages/desktop/src/main/utils/index.ts',
    text: 'TODO: Remove this function and load the recommend title from the editor (renderer) when',
    count: 1,
    reason:
      'upstream MarkText: the recommended title should come from the renderer once an IPC shape for it exists'
  },
  {
    file: 'packages/desktop/src/main/windows/editor.ts',
    text: "TODO: Close all watchers etc. Should we do this manually or listen to 'quit' event?",
    count: 1,
    reason:
      'upstream MarkText exit cluster: quit-time watcher teardown vs the quit-event ordering (see the cluster entry below)'
  },
  {
    file: 'packages/desktop/src/main/windows/editor.ts',
    text: "TODO: Don't allow new files if quitting.",
    count: 4,
    reason:
      'upstream MarkText exit cluster (4 identical sites): guard new-file opens while quitting. Needs a product decision on quit semantics — race window vs hard block — before any fix; register an issue first, do not drive-by delete'
  },
  // --- desktop: renderer (all inherited from upstream MarkText) -----------
  {
    file: 'packages/desktop/src/renderer/src/commands/index.ts',
    text: "TODO: Find next/previous doesn't work.",
    count: 1,
    reason: 'upstream MarkText: in-editor find is not wired to the command palette yet'
  },
  {
    file: 'packages/desktop/src/renderer/src/components/editorWithTabs/useEditorImages.ts',
    text: 'TODO(Refactor): Refactor this method.',
    count: 1,
    reason:
      'upstream MarkText: method predates the image-action split; cleanup rides the next image-pass'
  },
  {
    file: 'packages/desktop/src/renderer/src/prefComponents/image/components/uploader/services.ts',
    text: 'TODO: Remove information from other vue source files into this file.',
    count: 1,
    reason: 'upstream MarkText: uploader option sources are still scattered across .vue files'
  },
  {
    file: 'packages/desktop/src/renderer/src/prefComponents/keybindings/key-input-dialog.vue',
    text: 'FIXME: You can still write in the textbox while composition.',
    count: 1,
    reason:
      'upstream MarkText: IME composition still reaches the box; needs a composition-aware guard (real UX bug, low severity)'
  },
  {
    file: 'packages/desktop/src/renderer/src/prefComponents/keybindings/key-input-dialog.vue',
    text: 'TODO: Show shake animation on error text.',
    count: 1,
    reason: 'upstream MarkText: cosmetic affordance, no functional gap today'
  },
  // --- muya engine (all inherited from upstream @JOCS notes) --------------
  {
    file: 'packages/muya/src/block/base/content.ts',
    text: 'TODO: @JOCS, remove use this selection directly.',
    count: 1,
    reason:
      'engine upstream (@JOCS): use this.selection directly — part of the selection-API cleanup family below'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: @JOCS remove use this.selection directly',
    count: 2,
    reason: 'engine upstream (@JOCS): selection-API cleanup family (two identical sites)'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: @JOCS remove use this.selection directly.',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: @JOCS, remove use this.selection directly.',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: handle select multiple paragraphs',
    count: 1,
    reason: 'engine upstream: multi-paragraph selection handling in format.js is still open'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: The codes bellow maybe is wrong? and remove use this.selection directly',
    count: 1,
    reason:
      'engine upstream: the author flagged this code as maybe-wrong AND part of the selection cleanup — verify before removing'
  },
  {
    file: 'packages/muya/src/block/base/format.ts',
    text: 'TODO: USE `firstContentInDescendant`',
    count: 1,
    reason: 'engine upstream: use the firstContentInDescendant helper here'
  },
  {
    file: 'packages/muya/src/block/content/codeBlockContent/index.ts',
    text: 'TODO: throttle render',
    count: 1,
    reason: 'engine upstream: code-block render is not throttled'
  },
  {
    file: 'packages/muya/src/block/content/codeBlockContent/index.ts',
    text: 'TODO: @JOCS remove use this.selection directly',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/block/content/paragraphContent/index.ts',
    text: 'TODO: add labels in tokenizer...',
    count: 1,
    reason: 'engine upstream: tokenizer labels for paragraph content'
  },
  {
    file: 'packages/muya/src/block/extra/frontmatter/index.ts',
    text: 'TODO is there right?',
    count: 1,
    reason: 'engine upstream: open question on frontmatter block placement'
  },
  {
    file: 'packages/muya/src/block/gfm/table/index.ts',
    text: 'TODO',
    count: 1,
    reason: 'engine upstream: bare TODO with no text — remove on sight, it carries no information'
  },
  {
    file: 'packages/muya/src/editor/index.ts',
    text: "TODO: handler typeof d === 'string'",
    count: 1,
    reason: 'engine upstream: string payload branch unhandled in the editor drop path'
  },
  {
    file: 'packages/muya/src/editor/index.ts',
    text: 'TODO: the cursor maybe passed by muya options.cursor, and no need to find the first leaf block.',
    count: 1,
    reason:
      'engine upstream: cursor may arrive via options; the first-leaf-block search may be redundant'
  },
  {
    file: 'packages/muya/src/event/index.ts',
    text: 'TODO: @Jocs use the same name function in utils.',
    count: 1,
    reason: 'engine upstream: unify the function name with utils'
  },
  {
    file: 'packages/muya/src/inlineRenderer/index.ts',
    text: 'TODO: different content block should have different rules.',
    count: 1,
    reason: 'engine upstream: per-block-type inline renderer rules'
  },
  {
    file: 'packages/muya/src/state/markdownToHtml.ts',
    text: 'TODO: JOCS, are these codes still needed?',
    count: 1,
    reason: 'engine upstream: legacy html-state codes, possibly dead'
  },
  {
    file: 'packages/muya/src/state/markdownToState.ts',
    text: 'TODO: Treat html state which only contains one img as paragraph, we maybe add image state in the future.',
    count: 1,
    reason: 'engine upstream: single-img html state should become an image state'
  },
  {
    file: 'packages/muya/src/state/stateToMarkdown.ts',
    text: 'TODO: Indent subsequent paragraphs by one tab. - not important',
    count: 1,
    reason: 'engine upstream: subsequent-paragraph indent, self-marked not important'
  },
  {
    file: 'packages/muya/src/state/__tests__/listSerialization.spec.ts',
    text: 'TODO in stateToMarkdown.ts',
    count: 1,
    reason: 'test note pointing at the stateToMarkdown indent TODO above; keep the two in sync'
  },
  {
    file: 'packages/muya/src/ui/paragraphFrontButton/index.ts',
    text: 'TODO: @JOCS, remove use this.selection directly.',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/ui/paragraphFrontMenu/index.ts',
    text: 'TODO: @JOCS, remove use this.selection directly.',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/ui/tableDragBar/index.ts',
    text: 'TODO: @JOCS remove use this.selection directly',
    count: 1,
    reason: 'engine upstream (@JOCS): selection-API cleanup family'
  },
  {
    file: 'packages/muya/src/utils/highlightHTML.ts',
    text: 'TODO: @jocs any better solutions?',
    count: 1,
    reason: 'engine upstream: the author wanted a better approach for highlight HTML'
  },
  {
    file: 'packages/muya/src/utils/index.ts',
    text: 'TODO: @jocs rewrite in the future.',
    count: 1,
    reason: 'engine upstream: utils rewrite deferred'
  },
  {
    file: 'packages/muya/src/utils/marked/extensions/superSubscript.ts',
    text: 'TODO: why \\S in sup???',
    count: 1,
    reason: 'engine upstream: open question about the superscript regex'
  }
]

/** Ratchet baseline: marker count under the 口径 above, seeded 2026-10-20
 *  at 51 (the tree's current total; §13 documented 55 on 2026-09-26, four
 *  markers disappeared with later batches). Removing a marker means
 *  deleting its entry here AND lowering this number in the same change —
 *  never raising it. */
export const TODO_BASELINE = 51
