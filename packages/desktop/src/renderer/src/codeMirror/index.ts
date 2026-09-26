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
import 'codemirror/lib/codemirror.css'
import './index.css'
import 'codemirror/theme/railscasts.css'

// The runtime is imported from `codemirror/lib/codemirror` (an `any` shim), but
// the public editor surface is typed via `@types/codemirror`.
// Only the legacy `window.CodeMirror` exposure references this; never read typed.
type CodeMirrorLike = unknown
type CodeMirrorInstance = CodeMirror.Editor

loadmode(codeMirror)
overlayMode(codeMirror)
multiplexMode(codeMirror)
registerMarkdownMathMode(codeMirror)
;(window as unknown as { CodeMirror: CodeMirrorLike }).CodeMirror = codeMirror

codeMirror.modeURL = '../../../../node_modules/codemirror/mode/%N/%N.js'

export const setCursorAtFirstLine = (cm: CodeMirrorInstance): void => {
  cm.focus()
  cm.setCursor(0, 0)
}

export const setTextDirection = (cm: CodeMirrorInstance, textDirection: string): void => {
  cm.setOption('direction', textDirection as 'ltr' | 'rtl')
}

export default codeMirror
