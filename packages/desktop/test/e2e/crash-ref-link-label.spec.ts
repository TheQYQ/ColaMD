// Robustness guard for the reference-link label path in the engine.
//
// ScrollPage.updateRefLinkAndImage interpolates the label of a reference
// definition straight into a pattern: `new RegExp(`\\[${label}\\](?!:)`)`
// (packages/muya/src/block/scrollPage/index.ts:120-127), and the label comes
// from the document itself (ParagraphContent.update -> getLabelInfo,
// packages/muya/src/block/content/paragraphContent/index.ts:214-217).
//
// Two ways that hurts, both triggered by *opening a file* rather than by
// anything the reader does:
//  - an unbalanced group in the label makes `new RegExp` throw during render;
//  - a label with nested quantifiers is executed against every content block on
//    the renderer main thread, so a document that contains `[` + a long run of
//    the repeated character freezes the window.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { expectNoRendererErrors, focusEditor, launchWithMarkdown } from './helpers'

const UNBALANCED_LABEL_DOC =
  '# Ref link\n\n[a(b]: http://example.com "title"\n\nSee [a(b] for details.\n'

// The definition paragraph supplies the pattern, the last paragraph the input:
// `\[(a+)+b\](?!:)` against `[aaa...` backtracks through every partition. With
// 28 characters the single RegExp#test costs ~2.2 s (measured in node), which a
// 10 s poll swallows; 34 puts it in the minutes, so this case can only pass if
// the label never reaches an engine.
const CATASTROPHIC_LABEL_DOC = `# Ref link\n\n[(a+)+b]: http://example.com\n\n[${'a'.repeat(34)}\n`

const editorText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('.editor-component')?.textContent ?? '')

const launchQuiet = async (markdown: string): Promise<{ app: ElectronApplication; page: Page }> => {
  // suppressErrorDialog keeps the modal "Unexpected error" dialog from blocking
  // the spec; the renderer-error counter installed at launch still records what
  // the engine threw, including during the initial render.
  const launched = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
  await focusEditor(launched.page)
  return { app: launched.app, page: launched.page }
}

test.describe('Reference-link label is not a regex', () => {
  test('a label with an unbalanced group opens without a renderer error', async () => {
    const { app, page } = await launchQuiet(UNBALANCED_LABEL_DOC)
    try {
      await expect.poll(() => editorText(page)).toContain('example.com')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('a catastrophic label does not freeze the window on open', async () => {
    const { app, page } = await launchQuiet(CATASTROPHIC_LABEL_DOC)
    try {
      // Reaching this line at all is the assertion: the initial render runs the
      // label pattern over every content block, and the un-fixed engine spends
      // minutes inside a single RegExp#test.
      await expect.poll(() => editorText(page)).toContain('example.com')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
})
