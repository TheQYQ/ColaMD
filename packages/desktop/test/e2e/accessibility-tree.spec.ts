import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeApp, launchWithMarkdown } from './helpers'

// A11Y-11 / GUI-SC3. Chromium's accessibility tree is created lazily and its
// screen-reader detection depends on the platform, so "it probably exists" is
// not a claim we can make. The app now enables it explicitly at ready, and this
// spec reads the real tree over CDP: the document (a contenteditable rich
// editor) must surface as real heading nodes, and the chrome (sidebar tree)
// must be present too. What this cannot check is speech quality — that is the
// NVDA manual checklist in docs/NVDA_MANUAL_CHECKLIST.md.

interface AxNode {
  role?: { value?: string }
  name?: { value?: string }
}

const fullAxTree = async (page: Page): Promise<Array<{ role: string; name: string }>> => {
  const client = await page.context().newCDPSession(page)
  const { nodes } = (await client.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] }
  await client.detach()
  return nodes.map((node) => ({ role: node.role?.value ?? '', name: node.name?.value ?? '' }))
}

test.describe('Chromium accessibility tree (A11Y-11)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    const launched = await launchWithMarkdown('# AX probe\n\nHello from the accessibility probe.\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async () => {
    if (app) await closeApp(app)
  })

  test('accessibility support is enabled explicitly', async () => {
    expect(await app.evaluate(({ app }) => app.isAccessibilitySupportEnabled())).toBe(true)
  })

  test('the document and the chrome are in the accessibility tree', async () => {
    const nodes = await fullAxTree(page)

    // The rich editor is a contenteditable tree; if it degraded, the document
    // would not produce heading nodes at all. The heading's name also carries
    // the copy-anchor button's label ("复制此标题的锚点链接 # AX probe"), so
    // assert the document text rather than an exact name.
    expect(nodes.some((node) => node.role === 'heading' && node.name.includes('AX probe'))).toBe(
      true
    )

    // The sidebar file tree (SC-2) must also be reachable through the tree.
    expect(nodes.some((node) => node.role === 'tree')).toBe(true)
  })
})
