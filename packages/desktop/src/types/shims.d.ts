// Module shims for third-party libraries that ship no type declarations.
// Each entry is `any`-typed; refine as we discover the real shape.

declare module 'dom-autoscroller'
declare module '@hfelix/electron-localshortcut'
declare module 'iso-639-1'
declare module 'fuzzaldrin'
declare module 'ced'
declare module 'font-list'
declare module 'command-exists'
// `codemirror` (the bare module) is typed by `@types/codemirror`; only the
// submodules below ship no declarations and are shimmed as `any`.
declare module 'codemirror/keymap/*'
declare module 'codemirror/lib/*'
declare module 'codemirror/mode/*'
declare module 'codemirror/addon/*'
declare module 'electron-window-state'
declare module 'plist'

declare module '@marktext/file-icons' {
  interface FileIcon {
    getClass(colourMode?: number, asObject?: boolean): string
  }
  interface FileIcons {
    matchName(name: string): FileIcon | null
    matchLanguage(lang: string): FileIcon | null
  }
  const fileIcons: FileIcons
  export default fileIcons
}

// Electron augments `process` with `resourcesPath` (and a few other fields)
// at runtime. Surface them so common/* code can read them without casts.
declare namespace NodeJS {
  interface Process {
    resourcesPath: string
  }
  interface Global {
    __static: string
    COLAMD_DEBUG: boolean
    COLAMD_DEBUG_VERBOSE: number
    COLAMD_SAFE_MODE: boolean
  }
}

// Main-process globals set at boot in src/main/{globalSetting,app/env}. The
// renderer exposes its own `__static` via the build-time define block.
// eslint-disable-next-line no-var
declare var __static: string
// eslint-disable-next-line no-var
declare var COLAMD_DEBUG: boolean
// eslint-disable-next-line no-var
declare var COLAMD_DEBUG_VERBOSE: number
// eslint-disable-next-line no-var
declare var COLAMD_SAFE_MODE: boolean
