// Doc-claims ledger: statements the repository docs make about the state of
// the tree itself (file existence, packaging exclusions). Prose drifts
// silently — PROJECT_GUIDE.md's feature table claimed `dev-app-update.yml`
// was missing while the file existed and its own §11.3 already carried the
// correction — so every claim that is cheap to check mechanically is
// registered here and verified by doc-claims.spec.ts.
//
// check-md-links.py (run by lint.yml) guards relative links and anchors
// inside the docs; this ledger guards their *content* claims. Scope is
// deliberately curated: existence and packaging statements the docs assert
// explicitly. It is not a general prose checker.
//
// Rules:
//   - a claim that stops being true fails the spec: fix the doc or the tree
//     first, then update the ledger in the same change — never delete a
//     failing claim silently
//   - `source.anchor` is a literal snippet of the doc's *correct* statement,
//     so rewording the claim (or reverting it to a stale form, which is how
//     the dev-app-update drift survived) breaks the anchor check and forces a
//     conscious ledger update
//   - restoring a file the docs declare deleted fails its file-missing claim;
//     that is intentional, because the declaring docs are stale too

interface DocClaimSource {
  /** Doc file (repo-root relative) that makes the claim. */
  file: string
  /** Literal snippet of the doc's current, correct statement. */
  anchor: string
}

type DocClaim =
  | { kind: 'file-exists'; path: string; claim: string; source: DocClaimSource }
  | { kind: 'file-missing'; path: string; claim: string; source: DocClaimSource }
  | {
    kind: 'file-contains'
    path: string
    needle: string
    claim: string
    source: DocClaimSource
  }
  | {
    kind: 'file-lacks'
    path: string
    needle: string
    claim: string
    source: DocClaimSource
  }

export const docClaims: DocClaim[] = [
  {
    kind: 'file-exists',
    path: 'packages/desktop/dev-app-update.yml',
    claim:
      'dev-app-update.yml exists, so the update flow can be exercised locally when running unpacked',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: 'dev-app-update.yml` 存在'
    }
  },
  {
    kind: 'file-missing',
    path: 'eslint.config.mjs',
    claim: 'the root ESLint config is eslint.config.js; the .mjs variant does not exist',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: '没有 `eslint.config.mjs`'
    }
  },
  {
    kind: 'file-contains',
    path: 'packages/desktop/electron-builder.yml',
    needle: 'dev-app-update.yml',
    claim:
      'electron-builder excludes dev-app-update.yml from the package (it is only read when unpacked)',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: '把它排除掉是**正确**行为'
    }
  },
  {
    kind: 'file-contains',
    path: 'packages/desktop/electron-builder.yml',
    needle: 'eslint.config.js',
    claim: 'electron-builder excludes eslint.config.js from the package',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: '已在 `:31` 排除'
    }
  },
  {
    kind: 'file-contains',
    path: 'docs/PROJECT_GUIDE.md',
    needle: 'preferences-contract-parity.spec.ts',
    claim:
      'the autosave/session-recovery row credits the spec that now guards the startUpAction enum across all four copies (§11.1-3 is the fixed initial defect)',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: 'preferences-contract-parity.spec.ts'
    }
  },
  {
    kind: 'file-missing',
    path: 'CLAUDE.md',
    claim: 'CLAUDE.md was deleted and replaced by AGENTS.md',
    source: {
      file: 'AGENTS.md',
      anchor: '已删除的 `CLAUDE.md`'
    }
  },
  {
    kind: 'file-missing',
    path: 'ColaMD_WORKPLAN.md',
    claim: 'ColaMD_WORKPLAN.md was deleted on 2026-09-27; history lives in git',
    source: {
      file: 'AGENTS.md',
      anchor: '均已删除'
    }
  },
  {
    kind: 'file-missing',
    path: 'CODE_REVIEW_AND_ROADMAP.md',
    claim: 'CODE_REVIEW_AND_ROADMAP.md was deleted on 2026-09-27; history lives in git',
    source: {
      file: 'AGENTS.md',
      anchor: '均已删除'
    }
  },
  {
    kind: 'file-missing',
    path: 'docs/OPTIMIZATION_ROADMAP.md',
    claim: 'docs/OPTIMIZATION_ROADMAP.md was retired and deleted on 2026-09-29',
    source: {
      file: 'AGENTS.md',
      anchor: '均已删除'
    }
  },
  {
    kind: 'file-missing',
    path: 'BUGLIST.md',
    claim: 'BUGLIST.md was retired and deleted after its audit items were fixed',
    source: {
      file: 'docs/PROJECT_GUIDE.md',
      anchor: '已退役删除'
    }
  },
  {
    kind: 'file-missing',
    path: 'docs/i18n',
    claim: 'docs/i18n was removed wholesale on 2026-10-03',
    source: {
      file: 'AGENTS.md',
      anchor: '已整体删除'
    }
  }
]

/** Files the docs declare deleted. Restoring any of them fails its claim;
 *  this baseline may only shrink (a restored file must be re-documented and
 *  its claim removed in the same change). */
export const DELETED_FILES_BASELINE = 7
