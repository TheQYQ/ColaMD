import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { DELETED_FILES_BASELINE, docClaims } from '../utils/docClaimsLedger'

// Doc claims about the tree, verified against the tree. The dev-app-update
// drift this mechanism exists for: PROJECT_GUIDUDE.md's feature table said
// dev-app-update.yml was missing while the file existed — and the doc's own
// §11.3 already carried the correction, so the two statements contradicted
// each other in the same file. Two checks make that class of drift red:
//
//   1. the tree matches every registered claim
//   2. the doc that makes each claim still contains the exact snippet of its
//      correct statement (source.anchor) — reverting the wording to the stale
//      form breaks the anchor even though the file mention survives
//
// check-md-links.py covers links and anchors inside the docs; this spec
// covers their content claims. See the ledger header for the rules.

const here = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(here, '../../..')
const REPO_ROOT = resolve(PKG_ROOT, '../..')

const readRepoFile = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf-8')

describe('doc claims about the tree', () => {
  it('holds every registered claim', () => {
    const failures: string[] = []
    for (const claim of docClaims) {
      const abs = resolve(REPO_ROOT, claim.path)
      switch (claim.kind) {
        case 'file-exists':
          if (!existsSync(abs)) failures.push(`${claim.path} should exist — ${claim.claim}`)
          break
        case 'file-missing':
          if (existsSync(abs)) failures.push(`${claim.path} should not exist — ${claim.claim}`)
          break
        case 'file-contains':
          if (!existsSync(abs)) {
            failures.push(`${claim.path} should exist — ${claim.claim}`)
          } else if (!readRepoFile(claim.path).includes(claim.needle)) {
            failures.push(`${claim.path} should contain "${claim.needle}" — ${claim.claim}`)
          }
          break
        case 'file-lacks':
          if (existsSync(abs) && readRepoFile(claim.path).includes(claim.needle)) {
            failures.push(`${claim.path} should not contain "${claim.needle}" — ${claim.claim}`)
          }
          break
      }
    }
    expect(failures).toEqual([])
  })

  it('anchors every claim in the doc that makes it', () => {
    const orphans = docClaims
      .filter((claim) => {
        const docPath = resolve(REPO_ROOT, claim.source.file)
        return (
          !existsSync(docPath) || !readRepoFile(claim.source.file).includes(claim.source.anchor)
        )
      })
      .map(
        (claim) =>
          `${claim.source.file} no longer contains "${claim.source.anchor}" (claim on ${claim.path})`
      )
    expect(
      orphans,
      'ledger claims whose doc statement was reworded or removed — update the doc or the ledger, consciously'
    ).toEqual([])
  })

  it('keeps the documented-deleted set at or below its baseline', () => {
    // Seeded 2026-10-20 at 7 (eslint.config.mjs + six retired docs). A file
    // coming back fails its own claim first; this ratchet then forces the
    // baseline down in the same change that re-documents it.
    const deleted = docClaims.filter((claim) => claim.kind === 'file-missing')
    expect(
      deleted.length,
      'documented-deleted files grew — restoring one means the declaring docs are stale too'
    ).toBeLessThanOrEqual(DELETED_FILES_BASELINE)
  })
})
