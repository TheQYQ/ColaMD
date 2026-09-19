import fs from 'fs'
import log from 'electron-log'
import { isDirectory2, isFile2 } from 'common/filesystem'

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
