import { watch, type Ref } from 'vue'
import type { PreferencesState } from '@/store/preferences'
// The engine owns these settings; the component only mirrors them. Each watcher below
// says "if the preference moved and an engine instance exists, push it" — 28 copies of
// that one sentence, which is why they left the component. The ones that also touch
// something else (source-mode CodeMirror styles, the DOM line-width rule, menu state,
// the native spellchecker) stayed in editor.vue for that reason.
//
// `forceRender` is muya's second setOptions argument; where a watcher used to omit it,
// the moved code still omits it rather than passing false, because muya defaults the
// parameter to false (muya.ts:338) and re-parsing behaviour keys off the option set
// (muya.ts:99-108), not off an explicit false.
interface Engine {
  setOptions(options: Record<string, unknown>, forceRender?: boolean): void
  setListIndentation(value: unknown): void
}
type MirrorKey =
  | 'fontSize'
  | 'lineHeight'
  | 'editorFontFamily'
  | 'preferLooseListItem'
  | 'tabSize'
  | 'theme'
  | 'sequenceTheme'
  | 'listIndentation'
  | 'frontmatterType'
  | 'superSubScript'
  | 'footnote'
  | 'mathLatexDelimiters'
  | 'inlineComment'
  | 'definitionList'
  | 'isHtmlEnabled'
  | 'isGitlabCompatibilityEnabled'
  | 'hideQuickInsertHint'
  | 'wrapCodeBlocks'
  | 'autoPairBracket'
  | 'autoPairMarkdownSyntax'
  | 'autoPairQuote'
  | 'trimUnnecessaryCodeBlockEmptyLines'
  | 'bulletListMarker'
  | 'orderListDelimiter'
  | 'hideLinkPopup'
  | 'autoCheck'
  | 'codeBlockLineNumbers'

export const useEngineOptionSync = ({
  editor,
  preferencesStore,
  resolveEditorFont,
  prefs
}: {
  editor: Ref<Engine | null>
  preferencesStore: Pick<PreferencesState, 'plantumlServer'>
  resolveEditorFont: (family: string) => string
  prefs: { [K in MirrorKey]: Ref<PreferencesState[K]> }
}): void => {
  const {
    fontSize,
    lineHeight,
    editorFontFamily,
    preferLooseListItem,
    tabSize,
    theme,
    sequenceTheme,
    listIndentation,
    frontmatterType,
    superSubScript,
    footnote,
    mathLatexDelimiters,
    inlineComment,
    definitionList,
    isHtmlEnabled,
    isGitlabCompatibilityEnabled,
    hideQuickInsertHint,
    wrapCodeBlocks,
    autoPairBracket,
    autoPairMarkdownSyntax,
    autoPairQuote,
    trimUnnecessaryCodeBlockEmptyLines,
    bulletListMarker,
    orderListDelimiter,
    hideLinkPopup,
    autoCheck,
    codeBlockLineNumbers
  } = prefs
  watch(fontSize, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ fontSize: value })
    }
  })

  watch(lineHeight, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ lineHeight: value })
    }
  })

  watch(editorFontFamily, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ editorFontFamily: resolveEditorFont(value) })
    }
  })

  watch(preferLooseListItem, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({
        preferLooseListItem: value
      })
    }
  })

  watch(tabSize, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ tabSize: value })
    }
  })

  watch(theme, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      // Agreement：Any black series theme needs to contain dark `word`.
      if (/dark/i.test(value)) {
        editor.value.setOptions(
          {
            mermaidTheme: 'dark',
            vegaTheme: 'dark'
          },
          true
        )
      } else {
        editor.value.setOptions(
          {
            mermaidTheme: 'default',
            vegaTheme: 'latimes'
          },
          true
        )
      }
    }
  })

  watch(sequenceTheme, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ sequenceTheme: value }, true)
    }
  })

  watch(
    () => preferencesStore.plantumlServer,
    (value, oldValue) => {
      if (value !== oldValue && editor.value) {
        editor.value.setOptions({ plantumlServer: value }, true)
      }
    }
  )

  watch(listIndentation, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setListIndentation(value)
    }
  })

  watch(frontmatterType, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ frontmatterType: value })
    }
  })

  watch(superSubScript, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ superSubScript: value }, true)
    }
  })

  watch(footnote, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ footnote: value }, true)
    }
  })

  watch(mathLatexDelimiters, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ mathLatexDelimiters: value }, true)
    }
  })

  watch(inlineComment, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ inlineComment: value }, true)
    }
  })

  watch(definitionList, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ definitionList: value }, true)
    }
  })

  watch(isHtmlEnabled, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ disableHtml: !value }, true)
    }
  })

  watch(isGitlabCompatibilityEnabled, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ isGitlabCompatibilityEnabled: value }, true)
    }
  })

  watch(hideQuickInsertHint, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ hideQuickInsertHint: value })
    }
  })

  watch(wrapCodeBlocks, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ wrapCodeBlocks: value })
    }
  })

  watch(autoPairBracket, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ autoPairBracket: value })
    }
  })

  watch(autoPairMarkdownSyntax, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ autoPairMarkdownSyntax: value })
    }
  })

  watch(autoPairQuote, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ autoPairQuote: value })
    }
  })

  watch(trimUnnecessaryCodeBlockEmptyLines, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ trimUnnecessaryCodeBlockEmptyLines: value })
    }
  })

  watch(bulletListMarker, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ bulletListMarker: value })
    }
  })

  watch(orderListDelimiter, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ orderListDelimiter: value })
    }
  })

  watch(hideLinkPopup, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ hideLinkPopup: value })
    }
  })

  watch(autoCheck, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ autoCheck: value })
    }
  })

  watch(codeBlockLineNumbers, (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ codeBlockLineNumbers: value }, true)
    }
  })
}
