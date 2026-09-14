<template>
  <div
    ref="sourceCodeContainer"
    class="source-code"
  />
</template>

<script setup lang="ts">
import { ref, markRaw, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { findMarkdownHeadingLine, scrollSourceEditorToLine, findActiveHeadingIndex } from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { wordCount as getWordCount } from '@muyajs/core'
import { adjustCursor } from '../../util'
import bus from '../../bus'
import { oneDarkThemes, railscastsThemes } from '@/config'

// CodeMirror 5 ships no first-party types; the wrapper in src/renderer/src/
// codeMirror/index.ts also keeps the surface intentionally loose.
type CMInstance = any
type CMCursor = any

interface MuyaIndexCursorLike {
  anchor: CMCursor
  focus: CMCursor
}

const props = defineProps<{
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
}>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

const editor = ref<CMInstance>(null)
const commitTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const viewDestroyed = ref(false)
const tabId = ref<string | null>(null)

const { theme, sourceCode, mathLatexDelimiters } = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
}

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

const getMarkdownAndCursor = (cm: CMInstance) => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')

  const markdown: string = cm.getValue()
  const convertToMuyaCursor = (cursor: CMCursor) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(
      cursor,
      preLine,
      line,
      nextLine,
      (lineNumber) => {
        return cm.getLine(lineNumber)
      },
      cm.lineCount()
    )
  }

  anchor = convertToMuyaCursor(anchor) // Selection start as Muya cursor
  focus = convertToMuyaCursor(focus) // Selection end as Muya cursor

  // Normalize cursor that `anchor` is always before `focus` because
  // this is the expected behavior in Muya.
  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { cursor: { focus, anchor }, markdown }
}

/**
 * This is to write the OLD content of the editor before switching to another tab
 * @param id
 */
const prepareTabSwitch = () => {
  if (commitTimer.value) clearTimeout(commitTimer.value)
  if (tabId.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor
    })
    tabId.value = null
  }
}

interface FileChangePayloadLike {
  id: string
  markdown?: string
  muyaIndexCursor?: unknown
}

const handleFileChange = (payload: unknown) => {
  const { id, markdown: newMarkdown, muyaIndexCursor } = payload as FileChangePayloadLike
  if (!editor.value) return

  // On same-tab reload (external file change), preserve scroll across
  // setValue. Snapshot every plausible scroll element (the outer
  // .source-code div, CodeMirror's own scroller, and the nearest scrollable
  // ancestor) and restore each, since which one is actually active depends
  // on CodeMirror's height:auto + outer overflow:auto interplay. Re-apply
  // on nextTick and the next animation frame to outlast layout side-effects
  // from sibling handlers: muya editor.vue also listens for file-changed.
  // A cross-tab switch must instead commit the outgoing tab's state; the
  // fresh markdown from disk would otherwise overwrite uncommitted edits.
  const isSameTabReload = tabId.value && tabId.value === id
  const scrollTargets: Array<{ el: HTMLElement; top: number }> = []
  if (isSameTabReload) {
    const seen = new Set<HTMLElement>()
    const consider = (el: HTMLElement | null | undefined) => {
      if (el && !seen.has(el)) {
        seen.add(el)
        scrollTargets.push({ el, top: el.scrollTop })
      }
    }
    consider(sourceCodeContainer.value)
    consider(editor.value.getScrollerElement?.() as HTMLElement | null | undefined)
    let node: HTMLElement | null = sourceCodeContainer.value?.parentElement ?? null
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        consider(node)
        break
      }
      node = node.parentElement
    }
  } else {
    prepareTabSwitch()
    tabId.value = id
  }

  if (typeof newMarkdown === 'string') {
    editor.value.setValue(newMarkdown)
  }

  // t('editor.sourceCode.cursorNullComment')
  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(anchor, focus, { scroll: true }) // Scroll the focus into view.
  } else if (scrollTargets.length) {
    const restoreScroll = () => {
      for (const { el, top } of scrollTargets) el.scrollTop = top
    }
    restoreScroll()
    nextTick(restoreScroll)
    requestAnimationFrame(restoreScroll)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

const handleInvalidateImageCache = () => {
  if (editor.value) {
    editor.value.invalidateImageCache()
  }
}

const handleSelectAll = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.execCommand('selectAll')
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

const handleUndo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('undo')
  }
}

const handleRedo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('redo')
  }
}

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  const { id, result, alt } = payload as ImageActionPayload
  const value: string = editor.value.getValue()
  const focus = editor.value.getCursor('focus')
  const anchor = editor.value.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    editor.value.setValue(newValue)
    const match = /(!\[.*\]\(.*\))/.exec(oldLine)
    if (!match) {
      // t('editor.sourceCode.imageStructureDeletedComment')
      return
    }
    const range = {
      start: match.index,
      end: match.index + match[1].length
    }
    const delta = alt.length + result.length + 5 - match[1].length

    const adjustPointer = (pointer: CMCursor) => {
      if (!pointer) {
        return
      }
      if (pointer.line !== index) {
        return
      }
      if (pointer.ch <= range.start) {
        // do nothing.
      } else if (pointer.ch > range.start && pointer.ch < range.end) {
        pointer.ch = range.start + alt.length + result.length + 5
      } else {
        pointer.ch += delta
      }
    }

    adjustPointer(focus)
    adjustPointer(anchor)
    if (focus && anchor) {
      editor.value.setSelection(anchor, focus, { scroll: true })
    } else {
      setCursorAtFirstLine(editor.value)
    }
  }
}

const saveContent = (cm: CMInstance) => {
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  // Attention: the cursor may be `{focus: null, anchor: null}` when press `backspace`
  const wordCount = getWordCount(newMarkdown)
  // See "beforeDestroy" note
  if (!viewDestroyed.value) {
    if (tabId.value) {
      editorStore.LISTEN_FOR_CONTENT_CHANGE({
        id: tabId.value,
        markdown: newMarkdown,
        wordCount,
        muyaIndexCursor: cursor
      })
    } else {
      // This may occur during tab switching but should not occur otherwise.
      console.warn('LISTEN_FOR_CONTENT_CHANGE: Cannot commit changes because not tab id was set!')
    }
  }
}

const listenChange = () => {
  editor.value.on('cursorActivity', (cm: CMInstance) => {
    saveContent(cm)
    // Outline follow (Typora parity): highlight the TOC entry of the section
    // the caret sits in. Heading index maps 1:1 onto the store's listToc.
    const index = findActiveHeadingIndex(cm.getValue(), cm.getCursor('head').line)
    const slug = index >= 0 ? editorStore.listToc[index]?.slug ?? '' : ''
    if (slug !== lastSourceTocSlug) {
      lastSourceTocSlug = slug
      bus.emit('toc-active-changed', slug)
    }
    // Mirror the WYSIWYG selection prefill: expose the selected text through
    // the store so opening Find (Ctrl+F) seeds the query with it. Skipped
    // while a search has results so refreshing matches can't clobber them.
    const selectionText: string = cm.getSelection()
    if (selectionText && sourceMatches.value.length === 0 && selectionText.length <= 200) {
      editorStore.SEARCH({ matches: [], index: -1, value: selectionText })
    }
  })
}

let lastSourceTocSlug = ''

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
const handleScrollToHeader = (slug: unknown) => {
  if (!editor.value) return
  const index = editorStore.listToc.findIndex(item => item.slug === slug)
  if (index < 0) return
  const line = findMarkdownHeadingLine(editor.value.getValue(), index)
  if (line < 0) return
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(editor.value, line, sourceCodeContainer.value)
}

// ---------------------------------------------------------------------------
// Find & replace — source-mode CodeMirror backend.
// In source-code mode the WYSIWYG search handlers in editor.vue step aside and
// these own the `searchValue` / `replaceValue` / `find-action` bus events,
// driving CodeMirror's searchcursor addon. Match metadata is published through
// the same `editorStore.SEARCH` channel, so the shared search bar UI (match
// count / index) works unchanged across both modes.
// ---------------------------------------------------------------------------

interface ISearchOptions {
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  isRegexp?: boolean
}

interface ISourceMatch {
  from: CMCursor
  to: CMCursor
  text: string
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildSearchQuery = (value: string, opt: ISearchOptions): string | RegExp => {
  const flags = opt.isCaseSensitive ? 'g' : 'gi'
  if (opt.isRegexp) return new RegExp(value, flags)
  if (opt.isWholeWord) return new RegExp(`\\b(?:${escapeRegExp(value)})\\b`, flags)
  return value
}

const posCompare = (a: CMCursor, b: CMCursor): number => a.line - b.line || a.ch - b.ch

const sourceMatches = ref<ISourceMatch[]>([])
const sourceMatchIndex = ref(-1)
const sourceSearchValue = ref('')
const lastSearchOpt = ref<ISearchOptions>({})

const publishSourceMatches = () => {
  editorStore.SEARCH({
    index: sourceMatchIndex.value,
    value: sourceSearchValue.value,
    matches: sourceMatches.value.map(m => ({ start: m.from, end: m.to, match: m.text }))
  })
}

const handleSourceSearchValue = (payload: unknown) => {
  const cm = editor.value
  if (!cm) return
  const { value = '', opt = {} } = (payload ?? {}) as { value?: string; opt?: ISearchOptions }
  lastSearchOpt.value = opt
  sourceSearchValue.value = value

  if (!value) {
    sourceMatches.value = []
    sourceMatchIndex.value = -1
    editorStore.SEARCH({ index: -1, matches: [], value: '' })
    return
  }

  let query: string | RegExp
  try {
    query = buildSearchQuery(value, opt)
  } catch {
    sourceMatches.value = []
    sourceMatchIndex.value = -1
    publishSourceMatches()
    return
  }

  const matches: ISourceMatch[] = []
  cm.operation(() => {
    const cursor = cm.getSearchCursor(query, { line: 0, ch: 0 }, { multiline: true })
    while (cursor.findNext()) {
      matches.push({
        from: cursor.from(),
        to: cursor.to(),
        text: cm.getRange(cursor.from(), cursor.to())
      })
      if (matches.length >= 10000) break
    }
  })
  sourceMatches.value = matches

  // Select the first match at/after the caret (wrap to the first match).
  const head = cm.getCursor('from')
  let index = matches.findIndex(m => posCompare(m.from, head) >= 0)
  if (index < 0 && matches.length > 0) index = 0
  sourceMatchIndex.value = index
  if (index >= 0) {
    const match = matches[index]!
    cm.setSelection(match.from, match.to, { scroll: true })
  }
  publishSourceMatches()
}

const handleSourceFindAction = (action: unknown) => {
  const cm = editor.value
  if (!cm || sourceMatches.value.length === 0) return
  const n = sourceMatches.value.length
  const next = action === 'prev'
    ? (sourceMatchIndex.value - 1 + n) % n
    : (sourceMatchIndex.value + 1) % n
  const match = sourceMatches.value[next]!
  sourceMatchIndex.value = next
  cm.setSelection(match.from, match.to, { scroll: true })
  cm.focus()
  publishSourceMatches()
}

const handleSourceReplaceValue = (payload: unknown) => {
  const cm = editor.value
  if (!cm) return
  const { value: replacement = '', opt = {} } = (payload ?? {}) as {
    value?: string
    opt?: { isSingle?: boolean } & ISearchOptions
  }

  if (opt.isSingle) {
    const index = sourceMatchIndex.value
    const match = sourceMatches.value[index]
    if (index < 0 || !match) return
    // Replace only while the selection still is the active match.
    const sel = cm.listSelections()[0]
    const from = {
      line: Math.min(sel.anchor.line, sel.head.line),
      ch: Math.min(sel.anchor.ch, sel.head.ch)
    }
    const to = {
      line: Math.max(sel.anchor.line, sel.head.line),
      ch: Math.max(sel.anchor.ch, sel.head.ch)
    }
    if (posCompare(from, match.from) === 0 && posCompare(to, match.to) === 0) {
      cm.replaceRange(replacement, match.from, match.to)
    }
  } else {
    let query: string | RegExp
    try {
      query = buildSearchQuery(sourceSearchValue.value, opt)
    } catch {
      return
    }
    cm.operation(() => {
      const cursor = cm.getSearchCursor(query, { line: 0, ch: 0 }, { multiline: true })
      while (cursor.findNext()) cursor.replace(replacement)
    })
  }

  // Re-run the search: the caret now sits at the end of the replacement, so
  // "replace" advances to the following match, Typora-style.
  handleSourceSearchValue({ value: sourceSearchValue.value, opt })
}

onMounted(() => {
  if (!currentTab.value) return
  const { id } = currentTab.value
  // reset currentTab scrollTop position because the codeMirror scroll position is completely different from the muya scroll position
  // reset blocks as well because the blocks are only valid in muya
  // reset cursor because this is a direct "key-cursor", not a muyaIndexCursor, which is {focus: number, anchor: number}
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, muyaIndexCursor, textDirection } = props
  const container = sourceCodeContainer.value
  const codeMirrorConfig: Record<string, unknown> = {
    value: markdown,
    lineNumbers: true,
    autofocus: true,
    lineWrapping: true,
    styleActiveLine: true,
    direction: textDirection,
    viewportMargin: Infinity,
    lineNumberFormatter (line: number) {
      if (line % 10 === 0 || line === 1) {
        return line
      } else {
        return ''
      }
    }
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('file-loaded', handleFileChange)
  bus.on('invalidate-image-cache', handleInvalidateImageCache)
  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('searchValue', handleSourceSearchValue)
  bus.on('replaceValue', handleSourceReplaceValue)
  bus.on('find-action', handleSourceFindAction)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  // `markdown-math` wraps the standard Markdown mode and delegates `$...$` and
  // `$$...$$` spans to stex so subscript underscores in math do not flip the
  // outer mode into emphasis. The `-latex` variant additionally delegates
  // `\(...\)` spans (mathLatexDelimiters preference).
  const applyMathMode = (latex: boolean) => {
    codeMirrorInstance.setOption('mode', latex ? 'markdown-math-latex' : 'markdown-math')
  }
  applyMathMode(mathLatexDelimiters.value)

  watch(mathLatexDelimiters, (value) => {
    applyMathMode(value)
  })

  codeMirrorInstance.on('contextmenu', (_cm: CMInstance, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(anchor, focus, { scroll: true })
    // Typora 1.13 parity: entering Source Code keeps the reading position.
    // viewportMargin: Infinity means CodeMirror's own scroller never moves —
    // scroll the outer container so the caret's line sits at the top of the
    // viewport (same convention as scrollSourceEditorToLine).
    if (sourceCodeContainer.value) {
      const headLine = Math.max(0, Number(focus?.line) || 0)
      sourceCodeContainer.value.scrollTop = codeMirrorInstance.heightAtLine(headLine, 'local')
    }
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  editor.value = codeMirrorInstance
  tabId.value = id

  listenChange()
})

onBeforeUnmount(() => {
  viewDestroyed.value = true
  if (commitTimer.value) clearTimeout(commitTimer.value)

  bus.off('file-loaded', handleFileChange)
  bus.off('invalidate-image-cache', handleInvalidateImageCache)
  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('image-action', handleImageAction)
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('searchValue', handleSourceSearchValue)
  bus.off('replaceValue', handleSourceReplaceValue)
  bus.off('find-action', handleSourceFindAction)

  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
  bus.emit('file-changed', {
    id: tabId.value,
    markdown: newMarkdown,
    muyaIndexCursor: cursor,
    renderCursor: true
  })
})
</script>

<style>
.source-code {
  height: calc(100vh - var(--titleBarHeight) - var(--menuBarHeight) - var(--statusBarHeight));
  box-sizing: border-box;
  overflow: auto;
}
.source-code .CodeMirror {
  height: auto;
  margin: 50px auto;
  max-width: var(--editorAreaWidth);
  background: transparent;
}
.source-code .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.source-code .CodeMirror-activeline-background,
.source-code .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
</style>
