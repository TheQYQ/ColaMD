import fs from 'fs-extra'
import commandExists from 'command-exists'
import { typedHandle } from './typedHandle'

export const registerCmdHandlers = (): void => {
  typedHandle('mt::cmd::exists', async(_event, name: string) => {
    try {
      if (commandExists.sync(name)) return true

      if (name === 'picgo' && process.platform === 'darwin') {
        const commonPaths = [
          '/usr/local/bin/picgo',
          '/opt/homebrew/bin/picgo',
          `${process.env.HOME}/.npm-global/bin/picgo`,
          `${process.env.HOME}/.npm/bin/picgo`,
          '/usr/local/lib/node_modules/.bin/picgo'
        ]
        for (const p of commonPaths) {
          if (fs.pathExistsSync(p)) return true
        }
      }
      return false
    } catch {
      return false
    }
  })
}
