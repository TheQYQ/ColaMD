import fs from 'fs'
import path from 'path'
import Store, { type Schema } from 'electron-store'
import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import log from 'electron-log'
import { isWindows } from '../config'
import { hasSameKeys } from '../utils'
import { onInternalChannel } from '../utils/internalIpc'
import { TypedEmitter } from '@shared/types/typedEmitter'
import type { IUserPreferences, StartUpAction } from '@shared/types/preferences'
import schema from './schema.json'

// Retired value, accepted only to be rewritten by the 0.18.6 migration below.
const LEGACY_LAST_STATE = 'lastState'

// The migration target is written through the shared union rather than as a
// loose string: if `openLastFolder` is ever renamed or dropped, this line fails
// to compile instead of persisting a value that `resolveStartupPlan` would then
// treat as "no plan" — which is exactly how the two sides drifted before O3.
const START_UP_ACTION_AFTER_LAST_STATE: StartUpAction = 'openLastFolder'

const PREFERENCES_FILE_NAME = 'preferences'

// The Preference class extends EventEmitter but does not currently emit any
// events itself — keep the event map empty until concrete events are added.
type PreferenceEvents = Record<string, unknown[]>

// Structural subset of EnvPaths/AppPaths — only `preferencesPath` is read here.
interface AppPaths {
  readonly preferencesPath: string
}

class Preference extends TypedEmitter<PreferenceEvents> {
  public readonly preferencesPath: string
  public readonly hasPreferencesFile: boolean
  public readonly store: Store<IUserPreferences>
  public readonly staticPath: string

  /**
   * @param paths The path instance.
   *
   * NOTE: This throws an exception when validation fails.
   */
  constructor(paths: AppPaths) {
    // NOTE: `--safe` does not skip this file. `init` below writes (defaults for a
    // first run, `store.delete` for outdated keys), so ignoring user settings
    // needs a read-only store mode first — otherwise safe mode would rewrite the
    // user's preferences instead of only shadowing them.
    super()

    const { preferencesPath } = paths
    this.preferencesPath = preferencesPath
    this.hasPreferencesFile = fs.existsSync(
      path.join(this.preferencesPath, `./${PREFERENCES_FILE_NAME}.json`)
    )
    this.store = new Store<IUserPreferences>({
      schema: schema as unknown as Schema<IUserPreferences>,
      name: PREFERENCES_FILE_NAME,
      migrations: {
        '0.18.6': (store) => {
          if ((store.get('startUpAction') as string) === LEGACY_LAST_STATE) {
            store.set('startUpAction', START_UP_ACTION_AFTER_LAST_STATE)
          }
        }
      },
      beforeEachMigration: (_store, context) => {
        log.info(`Preferences migration: ${context.fromVersion} -> ${context.toVersion}`)
      }
    })

    this.staticPath = path.join(global.__static, 'preference.json')
    this.init()
  }

  init = (): void => {
    let defaultSettings: Record<string, unknown> | null = null
    try {
      defaultSettings = JSON.parse(fs.readFileSync(this.staticPath, { encoding: 'utf8' }) || '{}')

      // Set best theme on first application start.
      if (nativeTheme.shouldUseDarkColors) {
        defaultSettings!.theme = 'dark'
      }

      if (!this.hasPreferencesFile) {
        // Leave `language` unset on first start: it is detected in
        // App._initializeLanguage after the `ready` event, because
        // `app.getLocale()` returns an empty string when called this early.
        delete defaultSettings!.language
      }
    } catch (err) {
      log.error(err)
    }

    if (!defaultSettings) {
      throw new Error('Can not load static preference.json file')
    }

    // I don't know why `this.store.size` is 3 when first load, so I just check file existed.
    if (!this.hasPreferencesFile) {
      this.store.set(defaultSettings)
    } else {
      // Because `this.getAll()` will return a plainObject, so we can not use `hasOwnProperty` method
      // const plainObject = () => Object.create(null)
      const userSetting = this.getAll() as Record<string, unknown>
      // Update outdated settings
      const requiresUpdate = !hasSameKeys(defaultSettings, userSetting)
      const userSettingKeys = Object.keys(userSetting)
      const defaultSettingKeys = Object.keys(defaultSettings)

      if (requiresUpdate) {
        // TODO(fxha): For performance reasons, we should try to replace 'electron-store' because
        //   it does multiple blocking I/O calls when changing entries. There is no transaction or
        //   async I/O available. The core reason we changed to it was JSON scheme validation.

        // Remove outdated settings
        for (const key of userSettingKeys) {
          if (!defaultSettingKeys.includes(key)) {
            delete userSetting[key]
            this.store.delete(key)
          }
        }

        // Add new setting options
        let addedNewEntries = false
        for (const key in defaultSettings) {
          if (!userSettingKeys.includes(key)) {
            addedNewEntries = true
            userSetting[key] = defaultSettings[key]
          }
        }
        if (addedNewEntries) {
          this.store.set(userSetting)
        }
      }
    }

    this._listenForIpcMain()
  }

  getAll(): IUserPreferences {
    return this.store.store as IUserPreferences
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, value)
    ipcMain.emit('broadcast-preferences-changed', { [key]: value })
  }

  getItem<T = unknown>(key: string): T {
    return this.store.get(key) as T
  }

  /**
   * Change multiple setting entries.
   *
   * @param settings A settings object or subset object with key/value entries.
   */
  setItems(settings: Record<string, unknown> | null | undefined): void {
    if (!settings) {
      log.error('Cannot change settings without entires: object is undefined or null.')
      return
    }

    // Storage keeps writing per key, exactly as before; only the notification
    // is merged. Subscribers fold the payload over getAll(), so looping the
    // emit woke each of them N times — a { theme, autoSave } pair rebuilt the
    // native menu twice.
    const keys = Object.keys(settings)
    for (const key of keys) {
      this.store.set(key, settings[key])
    }

    if (keys.length > 0) {
      ipcMain.emit('broadcast-preferences-changed', { ...settings })
    }
  }

  getPreferredEol(): 'lf' | 'crlf' {
    const endOfLine = this.getItem<string>('endOfLine')
    if (endOfLine === 'lf') {
      return 'lf'
    }
    return endOfLine === 'crlf' || isWindows ? 'crlf' : 'lf'
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-preference', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) {
        win.webContents.send('mt::user-preference', this.getAll())
      }
    })
    // `imageFolderPath` doubles as a write-scope grant: App registers it with
    // `addAllowedRoot`, so letting the renderer assign it would let a compromised
    // renderer widen its own mutation scope. Only the folder dialog in DataCenter
    // assigns that key, and the grant follows the user-data broadcast instead.
    ipcMain.on('mt::set-user-preference', (_e, settings: Record<string, unknown>) => {
      const { imageFolderPath, cliScript, ...rest } = settings || {}
      if (imageFolderPath !== undefined || cliScript !== undefined) {
        log.warn(
          'Rejected a renderer-side write of imageFolderPath and/or cliScript; both are assigned by a main-process dialog only.'
        )
      }
      this.setItems(rest)
    })
    // `cliScript` is the program `mt::uploader::upload` runs, so a value the
    // renderer can type is arbitrary code execution in the main process — same
    // class of hole as the write-scope root above, same fix: only a native file
    // dialog assigns it, and `setItem` broadcasts the result like any preference.
    ipcMain.on('mt::ask-for-modify-cli-script', async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const { filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'] })
      if (filePaths && filePaths[0]) {
        this.setItem('cliScript', filePaths[0])
      }
    })
    ipcMain.on('mt::cmd-toggle-autosave', () => {
      this.setItem('autoSave', !this.getItem('autoSave'))
    })

    onInternalChannel('set-user-preference', (settings: Record<string, unknown>) => {
      this.setItems(settings)
    })
  }
}

export default Preference
