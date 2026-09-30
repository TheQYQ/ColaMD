import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { ensureDirSync, isDirectory2, isFile2 } from 'common/filesystem'

export const RECENTLY_USED_DOCUMENTS_FILE_NAME = 'recently-used-documents.json'
export const MAX_RECENTLY_USED_DOCUMENTS = 12

/**
 * Returns the recently used documents and folders, dropping entries that no
 * longer exist on disk and capping the list at MAX_RECENTLY_USED_DOCUMENTS.
 */
export const readRecentlyUsedDocuments = (recentsPath: string): string[] => {
  if (!isFile2(recentsPath)) {
    return []
  }

  try {
    const recentDocuments: string[] = JSON.parse(fs.readFileSync(recentsPath, 'utf-8')).filter(
      (f: string) => f && (isFile2(f) || isDirectory2(f))
    )

    return recentDocuments.slice(0, MAX_RECENTLY_USED_DOCUMENTS)
  } catch (err) {
    log.error('Error while reading recently used documents:', err)
    return []
  }
}

/**
 * Persists the recently used documents list and reports whether it worked.
 *
 * A recents list that cannot be written must not fail the operation that only
 * *mentioned* it to the list. It used to: the bare `fs.writeFileSync` sat in the
 * `menu-add-recently-used` handler, which runs inside
 * `writeMarkdownFile(...).then(...)` (`main/menu/actions/file.ts:307`), so a
 * read-only file turned a save that had already succeeded into
 * `mt::tab-save-failure`, and on save-as it skipped the `mt::set-pathname` that
 * follows. Matches the read side above, which already swallows. #26 item 3.
 */
export const writeRecentlyUsedDocuments = (recentsPath: string, documents: string[]): boolean => {
  try {
    ensureDirSync(path.dirname(recentsPath))
    fs.writeFileSync(recentsPath, JSON.stringify(documents, null, 2), 'utf-8')
    return true
  } catch (err) {
    log.error('Error while writing recently used documents:', err)
    return false
  }
}
