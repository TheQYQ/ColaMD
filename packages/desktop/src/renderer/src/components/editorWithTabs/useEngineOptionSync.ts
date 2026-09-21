import { watch, type Ref } from 'vue'
import type { PreferencesState } from '@/store/preferences'
// The engine owns these settings; the component only mirrors them. Each watcher below
// says the same sentence — "if the preference moved and an engine instance exists, push
// it" — 28 copies of it, which is why they left the component. Two reasons a watcher
// stays in editor.vue instead: it ALSO does something else on the same change (re-style
// source-mode CodeMirror, resize the DOM line-width rule, re-enable the menus, switch
// the native spellchecker), or it dereferences the engine without the existence guard
// that every watcher here has. `spellcheckerNoUnderline` is the second case, sitting
// between two spellchecker watchers that are first case as well.
//
// What this file does NOT buy: the option keys in the bodies are unchecked (muya takes
// Partial<IMuyaOptions>, muya.ts:338, while `Engine` here takes Record<string, unknown>),
// and the editor ref arrives typed `any` from the component, so nothing binds that call.
// What is enforced is the mapping between each preference name and the ref passed in,
// via MirrorKey below — which is also why the unguarded watcher above cannot be moved
// without either lying about the ref or silently swallowing a pre-mount change.
//
// `forceRender` keeps its omission where the original omitted it: muya defaults that
// parameter to false, and which options force a re-parse is a fixed set
// (muya.ts:100-109), not something an explicit false changes.
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
