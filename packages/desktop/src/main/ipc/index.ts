import { registerBootInfo } from './bootInfo'
import { registerDialogHandlers } from './dialog'
import { registerFsHandlers } from './fs'
import { registerPathHandlers } from './paths'
import { registerRipgrepHandlers } from './ripgrep'
import { registerUploaderHandlers } from './uploader'
import { registerFontsHandlers } from './fonts'
import { registerShellHandlers } from './shell'
import { registerWindowHandlers } from './window'
import { registerCmdHandlers } from './cmd'
import { registerI18nHandlers } from './i18n'
import { registerMenuHandlers } from './menu'

export const registerSandboxIpcHandlers = (): void => {
  registerBootInfo()
  registerDialogHandlers()
  registerFsHandlers()
  registerPathHandlers()
  registerRipgrepHandlers()
  registerUploaderHandlers()
  registerFontsHandlers()
  registerShellHandlers()
  registerWindowHandlers()
  registerCmdHandlers()
  registerI18nHandlers()
  registerMenuHandlers()
}
