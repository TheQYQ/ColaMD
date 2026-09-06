import { expect, test } from '@playwright/test'
import { launchElectron, launchWithMarkdown } from './helpers'

test.describe('Auto-show sidebar TOC on file open', () => {
  test('reveals the sidebar TOC when a markdown file opens', async() => {
    const { app, page } = await launchWithMarkdown('# Heading One\n\ncontent\n\n## Heading Two\n')

    try {
      const toc = page.locator('.side-bar-toc')
      await expect(toc).toBeVisible()
      // The panel must carry the seeded headings, not just an empty shell.
      await expect(toc.locator('.el-tree')).toBeVisible()
      await expect(toc.getByText('Heading One')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('stays hidden when only a blank untitled tab opens', async() => {
    const { app, page } = await launchElectron()

    try {
      // Untitled blanks have no pathname — the auto-show action skips them,
      // and the default sideBarVisibility preference keeps the sidebar closed.
      await expect(page.locator('.side-bar-toc')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
