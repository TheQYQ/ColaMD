// Parity ledger: the machine-readable registry behind
// packages/desktop/test/PARITY_SCOREBOARD.md. The muyajs → @muyajs/core
// migration (PR #4406) left 15 confirmed functional-parity gaps; each was
// encoded as a failing regression test marked as an expected failure so the
// suites stayed green. parity-scoreboard.spec.ts parses the markdown board
// and requires an exact match with this registry — ids, severity, status
// and coverage locations — so the board can never claim a state the tree
// does not have, and the open-gap count is ratcheted down.
//
// Batch note (2026-10-20): seeding this registry immediately caught the
// board's last stale row. PG14 was still marked "❌ xfail (accept-defer)"
// with a rationale for REJECTING a fix, but the fix had landed by another
// route — `Muya.replaceContent` records the source-mode bulk change as one
// fully-invertible whole-document op (not the incremental pick/drop walker
// the old row rejected), with engine coverage in
// packages/muya/src/__tests__/replaceContent.spec.ts and three live e2e
// tests. The repo carries zero `test.fail()`/`it.fails()` markers. PG14 is
// registered fixed and the board was corrected in the same change.

type ParityStatus = 'fixed' | 'open'

export interface ParityEntry {
  /** Gap id as used in test titles (`PGn:`). */
  id: string
  severity: 'major' | 'minor'
  status: ParityStatus
  /** Coverage locations (repo-root relative) — must exist on disk. */
  tests: string[]
  /** Manual-QA checklist entry in PARITY_QA.md, when the gap has one. */
  qa?: string
  /** How the gap was closed (or why it is still open). */
  note: string
}

export const parityEntries: ParityEntry[] = [
  {
    id: 'PG1',
    severity: 'major',
    status: 'fixed',
    tests: [
      'packages/muya/src/selection/__tests__/paritySelectionChange.spec.ts',
      'packages/desktop/test/e2e/parity-pg1-menu-state.spec.ts'
    ],
    note: 'engine #4410 + desktop wave 2 (affiliation adapter)'
  },
  {
    id: 'PG2',
    severity: 'major',
    status: 'fixed',
    tests: [
      'packages/muya/src/__tests__/setCursorByOffset.spec.ts',
      'packages/desktop/test/e2e/parity-source-undo-saved.spec.ts'
    ],
    note: 'engine setCursorByOffset + desktop wave 2'
  },
  {
    id: 'PG3',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/block/gfm/taskListCheckbox/__tests__/parityAutoCheck.spec.ts'],
    note: 'engine fixed #4409'
  },
  {
    id: 'PG4',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/editor/__tests__/dragDropImage.spec.ts'],
    qa: 'PG4',
    note: 'engine fixed #4413; OS-level drop / assets persistence stays manual-QA'
  },
  {
    id: 'PG5',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/clipboard/__tests__/parityImagePaste.spec.ts'],
    qa: 'PG5',
    note: 'engine fixed #4411; OS-clipboard bitmap delivery stays manual-QA'
  },
  {
    id: 'PG6',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/clipboard/__tests__/parityImagePaste.spec.ts'],
    note: 'engine fixed #4411'
  },
  {
    id: 'PG7',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/state/__tests__/parityExportHtml.spec.ts'],
    note: 'engine fixed #4412'
  },
  {
    id: 'PG8',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/state/__tests__/parityExportHtml.spec.ts'],
    note: 'engine #4412 + desktop pdf.ts slugger (wave 2)'
  },
  {
    id: 'PG9',
    severity: 'major',
    status: 'fixed',
    tests: ['packages/muya/src/clipboard/__tests__/parityCopyAsRich.spec.ts'],
    note: 'engine #4411 + desktop copyAsRich map (wave 2)'
  },
  {
    id: 'PG10',
    severity: 'minor',
    status: 'fixed',
    tests: ['packages/muya/src/selection/__tests__/parityPreviewImage.spec.ts'],
    note: 'engine fixed #4414 (desktop subscription already present)'
  },
  {
    id: 'PG11',
    severity: 'minor',
    status: 'fixed',
    tests: ['packages/muya/src/__tests__/parityHeadingCopyLink.spec.ts'],
    note: 'engine #4414 + desktop subscription (wave 2)'
  },
  {
    id: 'PG12',
    severity: 'minor',
    status: 'fixed',
    tests: ['packages/muya/src/editor/__tests__/parityHideLinkPopup.spec.ts'],
    note: 'engine fixed #4409'
  },
  {
    id: 'PG13',
    severity: 'minor',
    status: 'fixed',
    tests: ['packages/muya/src/__tests__/parityInsertParagraphNested.spec.ts'],
    note: 'engine fixed #4408'
  },
  {
    id: 'PG14',
    severity: 'minor',
    status: 'fixed',
    tests: [
      'packages/muya/src/__tests__/replaceContent.spec.ts',
      'packages/desktop/test/e2e/parity-source-undo-saved.spec.ts'
    ],
    note: 'closed by Muya.replaceContent (single fully-invertible whole-document undo boundary) — the route the old accept-defer row had rejected; three live e2e tests, zero xfail markers'
  },
  {
    id: 'PG15',
    severity: 'minor',
    status: 'fixed',
    tests: ['packages/desktop/test/e2e/parity-source-undo-saved.spec.ts'],
    note: 'desktop fixed (wave 2, stable saved-id)'
  }
]

/** Ratchet baseline: gaps still open, seeded 2026-10-20 at 0 after the
 *  registry caught the board's stale PG14 row. Closing a gap means flipping
 *  its status here AND in the board in the same change; this number may
 *  only shrink — a newly discovered gap must be fixed before merge, not
 *  registered as an accepted failure. */
export const PARITY_OPEN_BASELINE = 0
