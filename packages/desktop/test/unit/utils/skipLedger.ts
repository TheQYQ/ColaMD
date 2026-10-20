// Skip/fixme ledger: every test that is switched off (Playwright
// `test.skip` / `test.fixme`, vitest `it.skipIf`, …) across the repo's spec
// files, registered with a reason. skip-ledger.spec.ts extracts the real
// call sites and requires an exact match, so a new unconditional skip or an
// unregistered conditional gate fails the suite — and the unconditional
// count may only shrink (unskip a test → delete its entry → lower the
// baseline).
//
// Two classes, two rules:
//   - unconditional (`test.skip('title')`, `test.fixme('title')`): debt.
//     Registered per site (file + exact title), ratcheted down. A skip with
//     no reason is exactly the silent-rot class this batch exists for.
//   - conditional (`test.skip(cond, 'why')`, `it.skipIf(cond)`): a gate,
//     not debt — platform semantics, browser flakiness, tool availability.
//     Registered as exemptions keyed by file + condition substring; the
//     exemption carries the reason. A new gate with an unregistered
//     condition still fails.
//
// `test.only` / `it.only` / `describe.only` / `xit` / `fit` / `.fails` are
// forbidden outright (focused or expected-failure tests lie about the
// suite's state); the parity scoreboard owns the one accepted-failure
// mechanism this repo ever had, and it is at zero.

export interface UnconditionalSkip {
  /** Repo-root-relative spec file. */
  file: string
  /** The exact test title passed to skip/fixme. */
  title: string
  kind: 'skip' | 'fixme'
  /** Why it is off, and what unskipping it would take. */
  reason: string
}

export const unconditionalSkips: UnconditionalSkip[] = [
  {
    file: 'packages/desktop/test/e2e/loose-list-toggle.spec.ts',
    title: 'menu click toggles a tight list loose (blank line) and back to tight',
    kind: 'fixme',
    reason:
      'headless gap, not a product bug: under xvfb the caret inside a list item is not reliably established, so the menu toggle no-ops (passes on a headed display). The toggle action itself is unit-covered in packages/muya/src/__tests__/updateParagraph.spec.ts — unskipping needs a headless caret primitive, tracked with the e2e flakiness log'
  },
  {
    file: 'packages/desktop/test/e2e/paragraph-blocks.spec.ts',
    title: 'Horizontal rule',
    kind: 'skip',
    reason:
      'HR insertion needs an empty paragraph with a live Muya cursor, which cannot be driven from outside the renderer on xvfb; menu-id smoke coverage lives in menu-sanity.spec.ts. Unskipping needs a Muya test hook to place the cursor'
  },
  {
    file: 'packages/desktop/test/e2e/paragraph-blocks.spec.ts',
    title: 'Insert table dialog opens and accepts default',
    kind: 'skip',
    reason: 'same empty-paragraph + live-cursor constraint as the HR skip above'
  },
  {
    file: 'packages/desktop/test/e2e/view-modes.spec.ts',
    title:
      'item 173: typewriter centers the caret; toggling off keeps it in view (not at the bottom)',
    kind: 'fixme',
    reason:
      'typewriter centering and post-toggle scroll settling need a real rendered viewport, which xvfb does not reproduce (passes headed); classified as manual QA in the typewriter checklist — tracker item 173'
  }
]

export interface ConditionalExemption {
  /** Spec files the gate covers (repo-root relative). */
  files: string[]
  /** Substring that must appear in the skip call's condition argument. */
  condition: string
  /** Why the gate exists. */
  reason: string
}

export const conditionalExemptions: ConditionalExemption[] = [
  {
    files: [
      'packages/muya/e2e/tests/editing/clipboard.spec.ts',
      'packages/muya/e2e/tests/editing/nbsp-editing.spec.ts',
      'packages/muya/e2e/tests/editing/paste-as-plain-text.spec.ts',
      'packages/muya/e2e/tests/editing/table-cell-selection.spec.ts',
      'packages/muya/e2e/tests/editing/table-rect-clipboard.spec.ts'
    ],
    condition: "browserName !== 'chromium'",
    reason:
      'ClipboardItem / clipboard read-write APIs are unreliable on Firefox/WebKit headless — muya e2e BACKLOG Phase 3; the gate disables the test only on the affected browser'
  },
  {
    files: ['packages/muya/e2e/tests/typing/ime.spec.ts'],
    condition: "browserName === 'webkit'",
    reason: 'synthetic IME composition is unreliable on WebKit — muya e2e BACKLOG'
  },
  {
    files: ['packages/desktop/test/e2e/export-long-image-and-pandoc.spec.ts'],
    condition: '!hasPandoc()',
    reason:
      'pandoc is not installed on every runner; the long-image/pandoc export suite is availability-gated by design, not debt'
  },
  {
    files: ['packages/desktop/test/unit/specs/write-file-atomic.spec.ts'],
    condition: "process.platform === 'win32'",
    reason:
      'POSIX permission-mode semantics (chmod 0600 round-trip) do not exist on win32; the assertion is platform-specific by nature'
  }
]

/** Ratchet baseline: unconditional skip/fixme sites, seeded 2026-10-20 at
 *  the tree's current four. Unskipping one means deleting its entry here
 *  AND lowering this number in the same change — never raising it. */
export const SKIP_BASELINE = 4
