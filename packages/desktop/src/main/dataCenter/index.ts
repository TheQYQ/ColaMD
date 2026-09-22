import fs from 'fs'
import path from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import schema from './schema.json'
import Store, { type Schema } from 'electron-store'
import log from 'electron-log'
import { ensureDirSync } from 'common/filesystem'
import { IMAGE_EXTENSIONS } from 'common/filesystem/paths'
import { TypedEmitter } from '@shared/types/typedEmitter'
import { typedHandle } from '../ipc/typedHandle'

const DATA_CENTER_NAME = 'dataCenter'

// No events emitted directly on `this`. ipcMain.emit is used for cross-
// process broadcasts but those don't fire through this instance.
type DataCenterEvents = Record<string, unknown[]>

interface DataCenterPaths {
  dataCenterPath: string
  userDataPath: string
}

class DataCenter extends TypedEmitter<DataCenterEvents> {
  dataCenterPath: string
  userDataPath: string
  hasDataCenterFile: boolean
  store: Store<Record<string, unknown>>

  constructor(paths: DataCenterPaths) {
    super()

    const { dataCenterPath, userDataPath } = paths
    this.dataCenterPath = dataCenterPath
    this.userDataPath = userDataPath
    this.hasDataCenterFile = fs.existsSync(
      path.join(this.dataCenterPath, `./${DATA_CENTER_NAME}.json`)
    )
    this.store = new Store<Record<string, unknown>>({
      schema: schema as Schema<Record<string, unknown>>,
      name: DATA_CENTER_NAME
    })

    this.init()
  }

  init(): void {
    const defaultData = {
      imageFolderPath: path.join(this.userDataPath, 'images'),
      screenshotFolderPath: path.join(this.userDataPath, 'screenshot'),
      webImages: [],
      cloudImages: [],
      currentUploader: 'picgo'
    }

    if (!this.hasDataCenterFile) {
      this.store.set(defaultData)
      ensureDirSync(this.store.get('screenshotFolderPath') as string)
    } else {
      // Migrate legacy uploader values that no longer exist
      const stored = this.store.get('currentUploader') as string | undefined
      if (stored === 'none' || stored === 'github') {
        this.store.set('currentUploader', 'picgo')
      }
    }
    this._listenForIpcMain()
  }

  getAll(): Record<string, unknown> {
    return this.store.store
  }

  addImage(key: string, url: string): void {
    const items = this.store.get(key) as Array<{ url: string; timeStamp: number }>
    const alreadyHas = items.some((item) => item.url === url)
    let item
    if (alreadyHas) {
      item = items.find((it) => it.url === url)
      if (item) item.timeStamp = +new Date()
    } else {
      item = { url, timeStamp: +new Date() }
      items.push(item)
    }

    ipcMain.emit('broadcast-web-image-added', { type: key, item })
    return this.store.set(key, items)
  }

  removeImage(type: string, url: string): unknown {
    const items = this.store.get(type) as unknown[]
    const index = items.indexOf(url)
    const item = items[index]
    if (index === -1) return
    items.splice(index, 1)
    ipcMain.emit('broadcast-web-image-removed', { type, item })
    return this.store.set(type, items)
  }

  getItem(key: string): unknown {
    return this.store.get(key)
  }

  /**
   * Persist one entry, including the folder side effect it owns. Shared by the
   * single and bulk paths so the rule lives in exactly one place.
   */
  _writeEntry(key: string, value: unknown): void {
    if (key === 'screenshotFolderPath') {
      ensureDirSync(value as string)
    }
    this.store.set(key, value)
  }

  setItem(key: string, value: unknown): void {
    this._writeEntry(key, value)
    ipcMain.emit('broadcast-user-data-changed', { [key]: value })
  }

  /**
   * Change multiple setting entries.
   */
  setItems(settings: Record<string, unknown>): void {
    if (!settings) {
      log.error('Cannot change settings without entires: object is undefined or null.')
      return
    }

    const keys = Object.keys(settings)
    for (const key of keys) {
      this._writeEntry(key, settings[key])
    }

    // One merged event per bulk update: the payload is forwarded to every window
    // unchanged, so N keys used to mean N round trips. Emitting after the writes
    // also means a window that reads back sees the new values.
    if (keys.length > 0) {
      ipcMain.emit('broadcast-user-data-changed', { ...settings })
    }
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-data', async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const userData = await this.getAll()
      win.webContents.send('mt::user-preference', userData)
    })

    // The caller may ask for the picker but may not supply the result: this
    // folder is registered as a write-scope root for the guarded fs channels.
    ipcMain.on('mt::ask-for-modify-image-folder-path', async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      const { filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      })
      if (filePaths && filePaths[0]) {
        this.setItem('imageFolderPath', filePaths[0])
      }
    })

    ipcMain.on('mt::set-user-data', (_e, userData: Record<string, unknown>) => {
      this.setItems(userData)
    })

    typedHandle('mt::ask-for-image-path', async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return ''
      const { filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Images',
            extensions: [...IMAGE_EXTENSIONS]
          }
        ]
      })

      if (filePaths && filePaths[0]) {
        return filePaths[0]
      } else {
        return ''
      }
    })
  }
}

export default DataCenter
