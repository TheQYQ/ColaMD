import type { StartUpAction } from '@shared/types/preferences'

export interface StartupSources {
  defaultDirectoryToOpen?: string
  lastOpenedFolder?: string
}

export type StartupPlan = { kind: 'restore' } | { kind: 'open'; path: string } | { kind: 'none' }

// Which stored folder each action opens. Keyed by StartUpAction so a value
// added to the union without a decision here is a compile error, not a silently
// ignored preference.
const PATH_SOURCE: Record<StartUpAction, keyof StartupSources | null> = {
  blank: null,
  restoreAll: null,
  folder: 'defaultDirectoryToOpen',
  openLastFolder: 'lastOpenedFolder'
}

/**
 * Decides what a startup action asks for, given the folders on record. Values
 * outside the union (a store written by an older build, for instance) resolve
 * to no plan rather than restoring anything.
 */
export const resolveStartupPlan = (
  action: string | undefined,
  sources: StartupSources
): StartupPlan => {
  if (action === 'restoreAll') {
    return { kind: 'restore' }
  }
  if (!action || !(action in PATH_SOURCE)) {
    return { kind: 'none' }
  }

  const key = PATH_SOURCE[action as StartUpAction]
  const path = key ? sources[key] : undefined
  return path ? { kind: 'open', path } : { kind: 'none' }
}
