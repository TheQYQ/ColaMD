import { isSamePathSync, isImageFile } from 'common/filesystem/paths'
import { typedHandle } from './typedHandle'
import { typedSyncOn } from './typedOn'

export const registerPathHandlers = (): void => {
  // The renderer's preload computes isChildOfDirectory / hasMarkdownExtension
  // locally (pure string ops, no IPC). Only `is-same-sync` and `is-image`
  // require fs in the rare case-insensitive / image-file path checks.
  typedSyncOn('mt::paths::is-same-sync', (event, a: string, b: string) => {
    event.returnValue = isSamePathSync(a, b, true)
  })
  typedHandle('mt::paths::is-image', (_e, p: string) => isImageFile(p))
}
