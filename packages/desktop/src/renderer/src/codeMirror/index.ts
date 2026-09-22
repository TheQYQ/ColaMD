import 'codemirror/addon/edit/closebrackets'
import 'codemirror/addon/edit/closetag'
import 'codemirror/addon/selection/active-line'
import 'codemirror/addon/search/searchcursor'
import 'codemirror/mode/meta'
import codeMirror from 'codemirror/lib/codemirror'
import type CodeMirror from 'codemirror'

import loadmode from './loadmode'
import overlayMode from './overlayMode'
import multiplexMode from './multiplexMode'
import registerMarkdownMathMode from './markdownMathMode'
import languages from './modes'
import 'codemirror/lib/codemirror.css'
import './index.css'
import 'codemirror/theme/railscasts.css'

// The runtime is imported from `codemirror/lib/codemirror` (an `any` shim), but
// the public editor surface is typed via `@types/codemirror`.
// Only the legacy `window.CodeMirror` exposure references this; never read typed.
type CodeMirrorLike = unknown
type CodeMirrorInstance = CodeMirror.Editor

interface ModeInfoEntry {
  name?: string
  mime?: string | string[]
  mimes?: string[]
  mode?: string
  [key: string]: unknown
}

interface MatchedMode {
  name: string
  mode: ModeInfoEntry
}

loadmode(codeMirror)
overlayMode(codeMirror)
multiplexMode(codeMirror)
registerMarkdownMathMode(codeMirror)
;(window as unknown as { CodeMirror: CodeMirrorLike }).CodeMirror = codeMirror

const modes: ModeInfoEntry[] = codeMirror.modeInfo
codeMirror.modeURL = '../../../../node_modules/codemirror/mode/%N/%N.js'

const getModeFromName = (name: string): MatchedMode | null => {
  let result: MatchedMode | null = null
  const lang = languages.filter((lang) => lang.name === name)[0]
  if (lang) {
    const { name, mode, mime } = lang
    const matched = modes.filter((m) => {
      if (m.mime) {
        if (Array.isArray(m.mime) && m.mime.indexOf(mime) > -1 && m.mode === mode) {
          return true
        } else if (typeof m.mime === 'string' && m.mime === mime && m.mode === mode) {
          return true
        }
      }
      if (Array.isArray(m.mimes) && m.mimes.indexOf(mime) > -1 && m.mode === mode) {
        return true
      }
      return false
    })
    if (matched.length && typeof matched[0] === 'object') {
      result = {
        name,
        mode: matched[0]
      }
    }
  }
  return result
}

export const setCursorAtFirstLine = (cm: CodeMirrorInstance): void => {
  cm.focus()
  cm.setCursor(0, 0)
}

export const setTextDirection = (cm: CodeMirrorInstance, textDirection: string): void => {
  cm.setOption('direction', textDirection as 'ltr' | 'rtl')
}

export default codeMirror
