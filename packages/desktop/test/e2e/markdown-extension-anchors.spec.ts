import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, setSourceMarkdown } from './helpers'

// O14 ④ — four engine capabilities that shipped with no desktop-level test at
// all. The engine package already proves the parsing (its `alert.spec.ts` and
// `defList.spec.ts` assert these very classes), so what is pinned here is the
// part only the app can show: a document reaches the engine through the real
// renderer, and — for the two extension flags — the preference actually reaches
// muya over the renderer → main store → broadcast → Pinia → watcher chain that
// `code-block-wrap.spec.ts` already exercises for the code-block options.
//
// Assertions are on classes and counts, never on rendered words: alert titles
// and the empty-TOC placeholder come from muya's locale tables.

const setPreference = async(
  app: ElectronApplication,
  page: Page,
  prefs: Record<string, unknown>
): Promise<void> => {
  await page.evaluate((payload) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', payload)
  }, prefs)
}

test.describe('Markdown extension capabilities in the real renderer', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# anchor\n\nplaceholder\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('a GitHub alert blockquote carries the alert type class', async() => {
    // Alerts are not behind a preference (muya config/index.ts has no flag for
    // them), so this is a plain render check — with the negative case, because
    // an ordinary quote must not be dressed up as an alert.
    await setSourceMarkdown(page, app, '> [!WARNING]\n> disk is nearly full\n')
    await expect(page.locator('blockquote.mu-block-quote.mu-alert.mu-alert-warning')).toHaveCount(1)

    await setSourceMarkdown(page, app, '> just a quotation\n')
    await expect(page.locator('blockquote.mu-block-quote')).toHaveCount(1)
    await expect(page.locator('blockquote.mu-alert')).toHaveCount(0)
  })

  test('definition lists render only once the preference is on', async() => {
    const doc = 'Term\n: def A\n: def B\n'

    // Off by default (store/preferences.ts:207), so the block stays a paragraph.
    await setSourceMarkdown(page, app, doc)
    await expect(page.locator('dl.mu-def-list')).toHaveCount(0)

    // One forceRender re-parse, and the same markdown becomes a definition list.
    await setPreference(app, page, { definitionList: true })
    await expect(page.locator('dl.mu-def-list')).toHaveCount(1)
    await expect(page.locator('dl.mu-def-list dt.mu-def-term')).toHaveCount(1)
    await expect(page.locator('dl.mu-def-list dd.mu-def-desc')).toHaveCount(2)

    await setPreference(app, page, { definitionList: false })
    await expect(page.locator('dl.mu-def-list')).toHaveCount(0)
  })

  test('inline comments become their own span once the preference is on', async() => {
    // The `%%` markers stay in the DOM as syntax — muya hides them with
    // `font-size: 0` (inlineSyntax.css:21), which `innerText` does not strip —
    // so what is pinned is the rendered comment body, not the absence of `%%`.
    await setPreference(app, page, { inlineComment: true })
    await setSourceMarkdown(page, app, 'keep %%aside%% visible\n')

    const comment = page.locator('span.mu-inline-comment')
    await expect(comment).toHaveCount(1)
    await expect(comment).toHaveText('aside')
  })

  test('a [toc] block builds a live table of contents', async() => {
    await setSourceMarkdown(page, app, '# Alpha\n\n# Beta\n\n[toc]\n')
    await expect(page.locator('figure.mu-toc-block')).toHaveCount(1)

    // The preview list is rebuilt asynchronously from the document headings, so
    // poll for its entries rather than sleeping a fixed amount.
    await expect
      .poll(() => page.locator('figure.mu-toc-block li.mu-toc-item').count(), { timeout: 5000 })
      .toBe(2)
  })
})
