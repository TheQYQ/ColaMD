import path from 'path'
import { app } from 'electron'

// Set `__static` path to static files in production / development depending on the environment
// Guard: in some Node/Electron version combos (e.g. Node 24 + Electron 42 in dev) the
// `app` export can be undefined at module-load time; fall back to process.cwd() in that case.
;(global as unknown as { __static: string }).__static = path
  .join(app ? (app.isPackaged ? process.resourcesPath : app.getAppPath()) : process.cwd(), 'static')
  .replace(/\\/g, '\\\\')
