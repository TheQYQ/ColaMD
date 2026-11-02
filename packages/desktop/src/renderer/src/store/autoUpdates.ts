import { defineStore } from 'pinia'
import notice from '../services/notification'
import { t } from '../i18n'

// The four update events carry a human-readable message string (see
// IpcMainEventChannels), so the notice bodies use it directly.
export const useAutoUpdatesStore = defineStore('autoUpdates', () => {
  function LISTEN_FOR_UPDATE(): void {
    window.electron.ipcRenderer.on('mt::UPDATE_ERROR', (_e, message) => {
      notice.notify({
        title: t('autoUpdates.update'),
        type: 'error',
        time: 10000,
        message
      })
    })
    window.electron.ipcRenderer.on('mt::UPDATE_NOT_AVAILABLE', (_e, message) => {
      notice.notify({
        title: t('autoUpdates.updateNotAvailable'),
        type: 'primary',
        message
      })
    })
    window.electron.ipcRenderer.on('mt::UPDATE_DOWNLOADED', (_e, message) => {
      notice.notify({
        title: t('autoUpdates.updateDownloaded'),
        type: 'info',
        message
      })
    })
    window.electron.ipcRenderer.on('mt::UPDATE_AVAILABLE', (_e, message) => {
      notice
        .notify({
          title: t('autoUpdates.updateAvailable'),
          type: 'primary',
          message,
          showConfirm: true
        })
        .then(() => {
          const needUpdate = true
          window.electron.ipcRenderer.send('mt::NEED_UPDATE', { needUpdate })
        })
        .catch(() => {
          const needUpdate = false
          window.electron.ipcRenderer.send('mt::NEED_UPDATE', { needUpdate })
        })
    })
  }

  return { LISTEN_FOR_UPDATE }
})
