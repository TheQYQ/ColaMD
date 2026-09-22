import { storeToRefs } from 'pinia'
import { de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW, type ILocale } from '@muyajs/core'
import { DEFAULT_CODE_FONT_FAMILY, DEFAULT_EDITOR_FONT_FAMILY } from '@/config'
import { guessClipboardFilePath } from '@/util/clipboard'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorImages } from './useEditorImages'

// O12 step 6 part B, third cut: everything `onMounted` needs to *configure* the
// engine, without the engine. The locale table, the two font resolvers and the
// option literal moved here verbatim; the component keeps constructing and
// wiring the instance.
//
// The only textual difference from the component is `markdown`, which arrives as
// the parameter (object shorthand) instead of `props.markdown`. Every other
// value was already read from the preferences store, so this module takes the
// same store references the component did rather than receiving them as
// arguments — same reason `useEditorImages` does not need any injection.

const MUYA_LOCALES: Record<string, ILocale> = {
  en,
  de,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  'zh-CN': zhCN,
  'zh-TW': zhTW
}

export const getMuyaLocale = (language: string): ILocale => MUYA_LOCALES[language] ?? en

const defaultFontFamily = DEFAULT_EDITOR_FONT_FAMILY

export const resolveEditorFont = (family: string): string =>
  family ? `${family}, ${defaultFontFamily}` : defaultFontFamily

export const resolveCodeFont = (family: string): string => `${family}, ${DEFAULT_CODE_FONT_FAMILY}`

// The prop is optional in the component, so the parameter keeps that shape —
// the literal assigned it into a `Record<string, unknown>` before.
export const createMuyaOptions = (markdown: string | undefined): Record<string, unknown> => {
  const preferencesStore = usePreferencesStore()
  const {
    focus,
    language,
    preferLooseListItem,
    autoPairBracket,
    autoPairMarkdownSyntax,
    trimUnnecessaryCodeBlockEmptyLines,
    autoPairQuote,
    bulletListMarker,
    orderListDelimiter,
    tabSize,
    fontSize,
    lineHeight,
    editorFontFamily,
    codeFontSize,
    codeFontFamily,
    wrapCodeBlocks,
    codeBlockLineNumbers,
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
    hideLinkPopup,
    autoCheck,
    sequenceTheme,
    theme,
    spellcheckerEnabled,
    spellcheckerNoUnderline
  } = storeToRefs(preferencesStore)
  const { imageAction: muyaImageAction } = useEditorImages()

  const options: Record<string, unknown> = {
    focusMode: focus.value,
    markdown,
    locale: getMuyaLocale(language.value),
    preferLooseListItem: preferLooseListItem.value,
    autoPairBracket: autoPairBracket.value,
    autoPairMarkdownSyntax: autoPairMarkdownSyntax.value,
    trimUnnecessaryCodeBlockEmptyLines: trimUnnecessaryCodeBlockEmptyLines.value,
    autoPairQuote: autoPairQuote.value,
    bulletListMarker: bulletListMarker.value,
    orderListDelimiter: orderListDelimiter.value,
    tabSize: tabSize.value,
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    editorFontFamily: resolveEditorFont(editorFontFamily.value),
    codeFontSize: codeFontSize.value,
    codeFontFamily: resolveCodeFont(codeFontFamily.value),
    wrapCodeBlocks: wrapCodeBlocks.value,
    codeBlockLineNumbers: codeBlockLineNumbers.value,
    listIndentation: listIndentation.value,
    frontmatterType: frontmatterType.value,
    superSubScript: superSubScript.value,
    footnote: footnote.value,
    mathLatexDelimiters: mathLatexDelimiters.value,
    inlineComment: inlineComment.value,
    definitionList: definitionList.value,
    disableHtml: !isHtmlEnabled.value,
    isGitlabCompatibilityEnabled: isGitlabCompatibilityEnabled.value,
    hideQuickInsertHint: hideQuickInsertHint.value,
    hideLinkPopup: hideLinkPopup.value,
    autoCheck: autoCheck.value,
    sequenceTheme: sequenceTheme.value,
    plantumlServer: preferencesStore.plantumlServer,
    spellcheckEnabled: spellcheckerEnabled.value,
    spellcheckHideMarks: spellcheckerNoUnderline.value,
    // Resolve the OS clipboard to a local file path on paste (image-from-file).
    clipboardFilePath: guessClipboardFilePath,
    // Read the OS clipboard's plain text for "Paste as Plain Text" (execCommand('paste') no longer fires).
    clipboardText: () => window.electron.clipboard.readText(),
    // Image-persist callbacks read by the engine's clipboard + drag-drop handlers
    // from `muya.options.*` (distinct from the ImageEditTool plugin option above).
    // Without these, local-file drag-drop, screenshot/binary clipboard paste, and
    // copy-to-assets on a pasted image file silently no-op or insert raw paths.
    imageAction: muyaImageAction,
    getPathForFile: (file: File) => window.electron.webUtils.getPathForFile(file)
  }

  if (/dark/i.test(theme.value)) {
    Object.assign(options, {
      mermaidTheme: 'dark',
      vegaTheme: 'dark'
    })
  } else {
    Object.assign(options, {
      mermaidTheme: 'default',
      vegaTheme: 'latimes'
    })
  }

  return options
}
