import { ipcMain } from 'electron'
import { loadTranslations } from 'common/i18n'

export const registerI18nHandlers = (): void => {
  ipcMain.handle('mt::i18n::load', (_e, language: string) => loadTranslations(language))
}
