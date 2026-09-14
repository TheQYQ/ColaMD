import { expect, test } from '@playwright/test'
import { launchElectron, launchWithMarkdown } from './helpers'

// Since the Typora-style sidebar rebuild the TOC panel never auto-opens (the
// autoShowToc preference was removed end-to-end): opening a file leaves the
// sidebar on its default files panel instead of switching to the TOC. This
// locks that contract — it replaces auto-show-toc.spec.ts, which asserted
// the removed behavior.
test.describe('TOC panel does not auto-open on file open', () => {
  test('opening a markdown file keeps the files panel, not the TOC', async() => {
    const { app, page } = await launchWithMarkdown('# Heading One\n\ncontent\n\n## Heading Two\n')

    try {
      // No async auto-show exists anymore; the wait only guards against a
      // late panel flip if one is ever reintroduced.
      await page.waitForTimeout(500)
      await expect(page.locator('.side-bar-toc')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('stays hidden when only a blank untitled tab opens', async() => {
    const { app, page } = await launchElectron()

    try {
      // Untitled blanks have no pathname, and the TOC panel is never
      // auto-selected.
      await expect(page.locator('.side-bar-toc')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
