import { nextTick, watch, type Ref } from 'vue'
import type { PreferencesState } from '@/store/preferences'
// The engine owns these settings; the component only mirrors them. Each mirror
// used to be five written-out lines saying the same sentence -- "if the
// preference moved and an engine instance exists, push it" -- 28 copies of it.
// They are now a table, and the sentence is written once, below.
//
// What the table must keep: the ORDER (a preference broadcast can change several
// keys in one tick, so a plain write landing after a forced re-parse behaves
// differently than before it) and each entry's own call shape. Both are pinned by
// `test/unit/specs/engine-option-mirror.spec.ts`, which asserts the exact engine
// call each preference produces.
//
// Two reasons a watcher stays in editor.vue instead: it ALSO does something else
// on the same change (re-style source-mode CodeMirror, resize the DOM line-width
// rule, re-enable the menus, switch the native spellchecker), or it dereferences
// the engine without the existence guard that every mirror here has.
// `spellcheckerNoUnderline` is the second case, sitting between two spellchecker
// watchers that are the first case.
//
// What this file does NOT buy: the option keys in the bodies are unchecked (muya
// takes Partial<IMuyaOptions>, muya.ts:338, while `Engine` here takes
// Record<string, unknown>), and the editor ref arrives typed `any` from the
// component, so nothing binds that call. What is enforced is the mapping between
// each preference name and the ref passed in, via MirrorKey below.
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
  | 'autoNumberMathBlocks'

/** Where a mirror watches from: a preference ref, or a getter for a value that
 *  lives outside the ref bundle (`plantumlServer`). */
type MirrorSource = Ref<unknown> | (() => unknown)

interface Mirror {
  source: MirrorSource
  push: (engine: Engine, value: unknown) => void
}

/** Pushes one option under its own name; `force` re-parses the document. */
const option =
  (key: string, force?: boolean) =>
    (engine: Engine, value: unknown): void => {
      engine.setOptions({ [key]: value }, force)
    }

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
}): { flushBootstrapOptions: () => void } => {
  // PERF-06 (#GUI-B6): the first full preference application (the bootstrap
  // broadcast that lands right after the engine mounts) used to fire one
  // mirror per key — every `force` mirror triggering a whole-document
  // Muya re-parse. The first tick's changes are collected instead and pushed
  // as ONE `setOptions(batch, true)`; every later change stays per-mirror.
  let bootstrapArmed = true
  let bootstrapScheduled = false
  const bootstrapBatch: Array<{ mirror: Mirror; value: unknown }> = []

  const flushBootstrapOptions = (): void => {
    if (!bootstrapArmed) return
    bootstrapArmed = false
    const batch = bootstrapBatch.splice(0)
    if (!batch.length || !editor.value) return
    const options: Record<string, unknown> = {}
    let listIndentation: unknown
    let hasListIndentation = false
    const collector: Engine = {
      setOptions: (o) => Object.assign(options, o),
      setListIndentation: (v) => {
        listIndentation = v
        hasListIndentation = true
      }
    }
    for (const { mirror, value } of batch) mirror.push(collector, value)
    editor.value.setOptions(options, true)
    if (hasListIndentation) editor.value.setListIndentation(listIndentation)
  }

  const pushMirror = (mirror: Mirror, value: unknown): void => {
    if (!editor.value) return
    if (bootstrapArmed) {
      bootstrapBatch.push({ mirror, value })
      if (!bootstrapScheduled) {
        bootstrapScheduled = true
        nextTick(() => {
          bootstrapScheduled = false
          flushBootstrapOptions()
        })
      }
      return
    }
    mirror.push(editor.value, value)
  }

  const mirrors: Mirror[] = [
    { source: prefs.fontSize, push: option('fontSize') },
    { source: prefs.lineHeight, push: option('lineHeight') },
    {
      source: prefs.editorFontFamily,
      push: (engine, value) => {
        engine.setOptions({ editorFontFamily: resolveEditorFont(value as string) })
      }
    },
    { source: prefs.preferLooseListItem, push: option('preferLooseListItem') },
    { source: prefs.tabSize, push: option('tabSize') },
    {
      source: prefs.theme,
      push: (engine, value) => {
        // Agreement: any black series theme needs to contain dark `word`.
        engine.setOptions(
          /dark/i.test(value as string)
            ? { mermaidTheme: 'dark', vegaTheme: 'dark' }
            : { mermaidTheme: 'default', vegaTheme: 'latimes' },
          true
        )
      }
    },
    { source: prefs.sequenceTheme, push: option('sequenceTheme', true) },
    {
      source: () => preferencesStore.plantumlServer,
      push: option('plantumlServer', true)
    },
    { source: prefs.listIndentation, push: (engine, value) => engine.setListIndentation(value) },
    { source: prefs.frontmatterType, push: option('frontmatterType') },
    { source: prefs.superSubScript, push: option('superSubScript', true) },
    { source: prefs.footnote, push: option('footnote', true) },
    { source: prefs.mathLatexDelimiters, push: option('mathLatexDelimiters', true) },
    { source: prefs.inlineComment, push: option('inlineComment', true) },
    { source: prefs.definitionList, push: option('definitionList', true) },
    {
      source: prefs.isHtmlEnabled,
      // The engine's option is the negation of the preference.
      push: (engine, value) => engine.setOptions({ disableHtml: !value }, true)
    },
    {
      source: prefs.isGitlabCompatibilityEnabled,
      push: option('isGitlabCompatibilityEnabled', true)
    },
    { source: prefs.hideQuickInsertHint, push: option('hideQuickInsertHint') },
    { source: prefs.wrapCodeBlocks, push: option('wrapCodeBlocks') },
    { source: prefs.autoPairBracket, push: option('autoPairBracket') },
    { source: prefs.autoPairMarkdownSyntax, push: option('autoPairMarkdownSyntax') },
    { source: prefs.autoPairQuote, push: option('autoPairQuote') },
    {
      source: prefs.trimUnnecessaryCodeBlockEmptyLines,
      push: option('trimUnnecessaryCodeBlockEmptyLines')
    },
    { source: prefs.bulletListMarker, push: option('bulletListMarker') },
    { source: prefs.orderListDelimiter, push: option('orderListDelimiter') },
    { source: prefs.hideLinkPopup, push: option('hideLinkPopup') },
    { source: prefs.autoCheck, push: option('autoCheck') },
    { source: prefs.codeBlockLineNumbers, push: option('codeBlockLineNumbers', true) },
    // Toggling the container class suffices: CSS counters renumber live.
    { source: prefs.autoNumberMathBlocks, push: option('autoNumberMathBlocks') }
  ]

  for (const mirror of mirrors) {
    watch(mirror.source as never, (value: unknown, oldValue: unknown) => {
      if (value !== oldValue) pushMirror(mirror, value)
    })
  }

  return { flushBootstrapOptions }
}
