import { loadTranslations } from 'common/i18n'
import { typedHandle } from './typedHandle'

export const registerI18nHandlers = (): void => {
  typedHandle('mt::i18n::load', (_e, language: string) => loadTranslations(language))
}
