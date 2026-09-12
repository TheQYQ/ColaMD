/**
 * DOCX export entry point (M4.2).
 *
 * Takes the styled HTML produced by `exportStyledHTML` and returns the final
 * .docx package bytes. Conversion runs in the renderer because the HTML needs
 * a real DOMParser; the main process only shows the save dialog and writes
 * the bytes (mirroring how styledHtml ships `content` through IPC).
 */
import { DocxBuilder } from './docx/document'

export function exportDocx(styledHtml: string, title: string): Uint8Array {
  const parsed = new DOMParser().parseFromString(styledHtml, 'text/html')

  // exportStyledHTML wraps the document in <article class="markdown-body">
  // (inside the page-container table only when a header/footer is requested —
  // the DOCX path passes none). Prefer the article; fall back to the body.
  const scope =
    parsed.body.querySelector('article.markdown-body') ?? parsed.body

  const builder = new DocxBuilder(title)
  const blocks = Array.from(scope.children).filter((el) => {
    // Scripts/styles from the styled export never belong in a document.
    const tag = el.tagName.toLowerCase()
    return tag !== 'script' && tag !== 'style'
  })

  if (blocks.length === 0 && scope.textContent?.trim()) {
    // Malformed fragment without block elements: emit what text there is.
    const p = parsed.createElement('p')
    p.textContent = scope.textContent
    builder.appendBlock(p)
  } else {
    for (const block of blocks) builder.appendBlock(block)
  }

  return builder.build()
}
