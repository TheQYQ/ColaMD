import { isEqualAccelerator } from 'common/keybinding'
import log from 'electron-log'
import getCommandDescriptionById from '@/commands/descriptions'
import { isOsx } from '@/util'

const SHORTCUT_TYPE_DEFAULT = 0
const SHORTCUT_TYPE_USER = 1

type ShortcutType = typeof SHORTCUT_TYPE_DEFAULT | typeof SHORTCUT_TYPE_USER

export interface UiKeybinding {
  id: string
  description: string
  accelerator: string
  type: ShortcutType
}

/** Failure hook for the auto-save fired by `change()` (#130). */
export interface KeybindingSaveHooks {
  onSaveError?: () => void
}

const getShortcutDescriptionById = (id: string): string => {
  const description = getCommandDescriptionById(id)
  if (!description) {
    return id
  }
  return description
}

export default class KeybindingConfigurator {
  defaultKeybindings: Map<string, string>
  keybindingList: UiKeybinding[]
  isDirty: boolean
  // Bumped by every mutation of `keybindingList`, so `save` can tell whether the
  // map it sent is still the whole story by the time the write comes back.
  private _revision = 0
  private _onSaveError?: () => void

  /**
   * ctor
   */
  constructor(
    defaultKeybindings: Map<string, string>,
    userKeybindings: Map<string, string>,
    hooks: KeybindingSaveHooks = {}
  ) {
    this.defaultKeybindings = defaultKeybindings
    this.keybindingList = this._buildUiKeybindingList(defaultKeybindings, userKeybindings)
    this.isDirty = false
    this._onSaveError = hooks.onSaveError
  }

  _buildUiKeybindingList(
    defaultKeybindings: Map<string, string>,
    userKeybindings: Map<string, string>
  ): UiKeybinding[] {
    const uiKeybindings: UiKeybinding[] = []
    for (const [id] of defaultKeybindings) {
      if (!isOsx && id.startsWith('mt.')) {
        // Skip ColaMD menu that is only available on macOS.
        continue
      }
      uiKeybindings.push(this._toUiKeybinding(id, defaultKeybindings, userKeybindings))
    }
    uiKeybindings.sort((a, b) => a.description.localeCompare(b.description))
    return uiKeybindings
  }

  _toUiKeybinding(
    id: string,
    defaultKeybindings: Map<string, string>,
    userKeybindings: Map<string, string>
  ): UiKeybinding {
    const description = getShortcutDescriptionById(id)
    const userAccelerator = userKeybindings.get(id)
    let type: ShortcutType = SHORTCUT_TYPE_DEFAULT

    // Overwrite accelerator if key is present (empty string unset old binding).
    let accelerator: string
    if (userAccelerator != null) {
      type = SHORTCUT_TYPE_USER
      accelerator = userAccelerator
    } else {
      accelerator = defaultKeybindings.get(id) ?? ''
    }
    return { id, description, accelerator, type }
  }

  getKeybindings(): UiKeybinding[] {
    return this.keybindingList
  }

  // Rebuild the keybinding list to update descriptions on language switch
  rebuildKeybindingList(): UiKeybinding[] {
    // Save the current user settings
    const userKeybindings = this._getUserKeybindingMap()
    // Rebuild the list
    this.keybindingList = this._buildUiKeybindingList(this.defaultKeybindings, userKeybindings)
    return this.keybindingList
  }

  async save(): Promise<boolean> {
    if (!this.isDirty) {
      return true
    }

    const userKeybindings = this._getUserKeybindingMap()
    const revision = this._revision
    const result = await window.electron.ipcRenderer.invoke(
      'mt::keybinding-save-user-keybindings',
      userKeybindings
    )
    if (result) {
      // Only clear the flag if nothing was edited while the write was on the wire.
      // `userKeybindings` was built before the await, so a later edit is NOT in the
      // file that just landed; clearing the flag anyway would drop it silently and
      // stop the preferences window from warning on close.
      if (this._revision === revision) {
        this.isDirty = false
      }
      return true
    }
    return false
  }

  _getUserKeybindingMap(): Map<string, string> {
    const userKeybindings = new Map<string, string>()
    for (const entry of this.keybindingList) {
      const { id, accelerator, type } = entry
      if (type !== SHORTCUT_TYPE_DEFAULT) {
        userKeybindings.set(id, accelerator)
      }
    }
    return userKeybindings
  }

  change(id: string, accelerator: string): boolean {
    const entry = this.keybindingList.find((entry) => entry.id === id)
    if (!entry) {
      return false
    }

    // UX-04 (#GUI-B10): the entry's own id is excluded, so re-confirming its
    // current accelerator is not reported as a self-conflict.
    if (accelerator && this._isDuplicate(accelerator, id)) {
      return false
    }

    entry.accelerator = accelerator
    entry.type = this._isDefaultBinding(id, accelerator)
      ? SHORTCUT_TYPE_DEFAULT
      : SHORTCUT_TYPE_USER
    this._revision += 1
    this.isDirty = true
    // UX-04: save immediately — every other preference applies live, and the
    // in-flight-write revision guard in save() keeps concurrent edits safe.
    this._persistImmediately()
    return true
  }

  /**
   * #130: `change()` cannot await the write (the caller expects a synchronous
   * boolean), so a rejected `invoke` used to surface as an unhandled rejection
   * with the preference silently unwritten. Route both failure shapes — a false
   * result and a rejection — through the injected hook.
   */
  private _persistImmediately(): void {
    void this.save()
      .then((ok) => {
        if (!ok) this._onSaveError?.()
      })
      .catch((error: unknown) => {
        log.error('Keybinding auto-save failed', error)
        this._onSaveError?.()
      })
  }

  /** The entry currently holding `accelerator`, if any (UX-04 conflict toast). */
  findConflict(
    accelerator: string,
    excludeId?: string
  ): { id: string; accelerator: string } | null {
    if (!accelerator) return null
    const entry = this.keybindingList.find(
      (entry) => entry.id !== excludeId && isEqualAccelerator(entry.accelerator, accelerator)
    )
    return entry ? { id: entry.id, accelerator: entry.accelerator } : null
  }

  unbind(id: string): boolean {
    return this.change(id, '')
  }

  resetToDefault(id: string): boolean {
    const accelerator = this.defaultKeybindings.get(id)
    if (accelerator == null) {
      // allow empty string
      return false
    }
    return this.change(id, accelerator)
  }

  async resetAll(): Promise<boolean> {
    const { defaultKeybindings, keybindingList } = this
    for (const entry of keybindingList) {
      const defaultAccelerator = defaultKeybindings.get(entry.id)
      if (defaultAccelerator) {
        entry.accelerator = defaultAccelerator
      } else {
        entry.accelerator = ''
      }
      entry.type = SHORTCUT_TYPE_DEFAULT
    }
    this._revision += 1
    this.isDirty = true
    return this.save()
  }

  getDefaultAccelerator(id: string): string | undefined {
    return this.defaultKeybindings.get(id)
  }

  _isDuplicate(accelerator: string, excludeId?: string): boolean {
    return this.findConflict(accelerator, excludeId) !== null
  }

  _isDefaultBinding(id: string, accelerator: string): boolean {
    return this.defaultKeybindings.get(id) === accelerator
  }
}
