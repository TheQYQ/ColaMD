import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { clickMenuById, closeApp, launchElectron, waitForMenuReady } from './helpers'

// GUI-SA prerequisite (GUI_FIX_PLAN §3.12): one full-window screenshot per
// selectable theme against a fixed scenario, archived under theme-baseline/
// as the "zero visual difference" reference for the theme-file slimming
// special. Regenerate with --update-snapshots, compare by running this spec
// plain; see theme-baseline/README.md.
//
// The baseline is OS/font-rendering dependent: it is generated and compared on
// this Windows machine only, so the whole suite is skipped elsewhere (the CI
// e2e legs are linux + macos and never consult these snapshot files).
test.skip(process.platform !== 'win32', 'Theme screenshot baseline is Windows-local by design')

// The 33 selectable theme ids in menu order (menu/templates/theme.ts). The
// beforeAll cross-checks this list against the live application menu, so a
// theme added or renamed on either side fails loudly instead of silently
// missing from the baseline.
const EXPECTED_THEMES: ReadonlyArray<string> = [
  // light
  'ayu-light',
  'light',
  'catppuccin-latte',
  'everforest-light',
  'graphite',
  'gruvbox-light',
  'rose-pine-dawn',
  'solarized-light',
  'tokyo-night-light',
  'ulysses',
  // dark
  'ayu-dark',
  'ayu-mirage',
  'dark',
  'catppuccin-mocha',
  'cyberdream',
  'dracula',
  'everforest-dark',
  'gruvbox-dark',
  'horizon-dark',
  'kanagawa',
  'material-dark',
  'monokai-pro',
  'nightfox',
  'nord',
  'one-dark',
  'oxocarbon-dark',
  'palenight',
  'rose-pine',
  'rose-pine-moon',
  'solarized-dark',
  'synthwave-84',
  'tokyo-night',
  'tokyo-night-storm'
]

// One document per tab: notes.md stays inactive so both tab states (active +
// inactive) are captured, theme-fixture.md is the active editor content. The
// fixture exercises every surface the theme files style: titlebar, self-drawn
// menubar, editor tabs, sidebar tree (folder + file rows), headings, inline
// formats, task list, blockquote, a prism-highlighted code block, table, hr
// and body text; the muya kebab-case editor variables paint the whole canvas.
const NOTES_MARKDOWN = [
  '# 第二篇笔记',
  '',
  '这个标签页保持非活动状态，用于对比活动/非活动标签页样式。'
].join('\n')

const FIXTURE_MARKDOWN = [
  '# Theme Visual Baseline 标题一',
  '',
  '这一段混排 **加粗 bold**、*斜体 italic*、~~删除线 del~~、`inline code`、[链接 link](https://example.com) 与一段 English sentence。',
  '',
  '## 二级标题 Heading Two',
  '',
  '- 无序列表项 alpha',
  '- 无序列表项 beta',
  '  1. 有序子项 one',
  '  2. 有序子项 two',
  '',
  '- [ ] 任务项 unchecked',
  '- [x] 任务项 checked',
  '',
  '> 引用块：The quick brown fox jumps over the lazy dog。敏捷的棕色狐狸跳过了懒狗。',
  '',
  '### 三级标题 Heading Three',
  '',
  '```js',
  '// prism tokens: comment, keyword, number, string',
  'function greet(name) {',
  '  const count = 42',
  // eslint-disable-next-line no-template-curly-in-string -- the fixture intentionally contains template-literal source so prism renders its interpolation tokens
  '  return `hello ${name}, #${count}`',
  '}',
  '```',
  '',
  '| 列甲 Col A | 列乙 Col B |',
  '| ---------- | ---------- |',
  '| A1         | B1         |',
  '| A2         | B2         |',
  '',
  '---',
  '',
  '结尾段落足够长以便换行，让行高与正文颜色可见。The final paragraph is long enough to wrap onto a second line so that line-height and body text color are visible in the baseline.'
].join('\n')

// The blinking caret is the only at-rest animated pixel in the window;
// toHaveScreenshot disables CSS animations itself but not the native caret.
// scroll-behavior is pinned so the programmatic scroll for the -bottom shot
// lands instantly instead of animating.
const FREEZE_STYLE =
  '*, *::before, *::after { caret-color: transparent !important; scroll-behavior: auto !important; }'

// util/theme.ts injects the theme sheet with this id (THEME_STYLE_ID).
const THEME_STYLE_SELECTOR = 'style#ag-theme'

const readThemeCss = (page: Page): Promise<string> =>
  page.evaluate((sel) => document.querySelector(sel)?.innerHTML ?? '', THEME_STYLE_SELECTOR)

// Theme CSS arrives asynchronously (PERF-05 lazy loading): wait until the
// injected sheet differs from the previous theme's content and has stopped
// changing, so the screenshot never races the style swap.
const applyThemeAndSettle = async (
  app: ElectronApplication,
  page: Page,
  id: string,
  previousCss: string
): Promise<string> => {
  await clickMenuById(app, id)
  const settleArg: [string, string] = [THEME_STYLE_SELECTOR, previousCss]
  await page.waitForFunction(
    ([sel, prev]: [string, string]) => {
      const css = document.querySelector(sel)?.innerHTML ?? ''
      return css.length > 0 && css !== prev
    },
    settleArg,
    { timeout: 10000 }
  )
  let last = ''
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(200)
    const current = await readThemeCss(page)
    if (current === last && current.length > 0) return current
    last = current
  }
  throw new Error(`Theme ${id} CSS did not settle to a stable value`)
}

// Scroll the editor area (`.editor-component` itself is the overflow: auto
// container, editor.vue). 'bottom' exposes the table, hr and closing
// paragraph that sit below the fold of the top shot.
const scrollEditorTo = async (page: Page, where: 'top' | 'bottom'): Promise<void> => {
  await page.evaluate((target) => {
    let el: Element | null = document.querySelector('.editor-component')
    while (el && el.scrollHeight <= el.clientHeight && el !== document.body) {
      el = el.parentElement
    }
    if (!el) return
    el.scrollTop = target === 'bottom' ? el.scrollHeight : 0
  }, where)
  await page.waitForTimeout(150)
}

test.describe('Theme visual baseline (GUI-SA prerequisite)', () => {
  let app: ElectronApplication
  let page: Page
  let tempDir: string

  test.beforeAll(async () => {
    // A FIXED directory name: the folder name shows up in the window title and
    // as the tree root label, so a mkdtemp random suffix would make every
    // screenshot differ between runs. Remove any stale leftover first.
    tempDir = path.join(os.tmpdir(), 'colamd-theme-baseline')
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'notes.md'), NOTES_MARKDOWN, 'utf-8')
    fs.writeFileSync(path.join(tempDir, 'src', 'theme-fixture.md'), FIXTURE_MARKDOWN, 'utf-8')

    // Launching with a directory opens it as a project root, which populates
    // the sidebar file tree. The app directory itself (packages/desktop) also
    // travels in argv (parseArgs slices process.argv, which Electron prefixes
    // with the app path), so TWO editor windows open: the app dir and the
    // fixture root. Bind to the fixture window by its tree label — never by
    // window order.
    const launched = await launchElectron([tempDir])
    app = launched.app
    const dirName = path.basename(tempDir)
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      for (const candidate of app.windows()) {
        const label = await candidate
          .getByRole('tree')
          .getAttribute('aria-label')
          .catch(() => null)
        if (label === dirName) {
          page = candidate
          break
        }
      }
      if (page) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!page) throw new Error(`No editor window rooted at ${dirName} within 15s`)
    await page.bringToFront()
    await waitForMenuReady(app)

    const menuThemeIds = await app.evaluate(({ Menu }) => {
      const collect = (items: Electron.MenuItem[]): string[] =>
        items.flatMap((item) => {
          if (item.type === 'radio' && item.id) return [item.id]
          return item.submenu ? collect(item.submenu.items) : []
        })
      const themeMenu = Menu.getApplicationMenu()?.getMenuItemById('themeMenu')
      return themeMenu?.submenu ? collect(themeMenu.submenu.items) : []
    })
    expect(menuThemeIds).toEqual([...EXPECTED_THEMES])

    // Open notes.md first (tab 1), then expand src/ and open the fixture
    // (tab 2, active) so both tab states are visible.
    await page.getByRole('treeitem', { name: 'notes.md' }).click()
    await page.waitForSelector('.editor-component', { state: 'attached', timeout: 15000 })
    await page.getByRole('treeitem', { name: 'src' }).locator('.folder-name').click()
    await page.getByRole('treeitem', { name: 'theme-fixture.md' }).click()
    await page.waitForFunction(() => document.body.textContent?.includes('Theme Visual Baseline'))
    await page.addStyleTag({ content: FREEZE_STYLE })
    await page.waitForTimeout(500)
  })

  test.afterAll(async () => {
    await closeApp(app)
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* temp best-effort */
    }
  })

  let previousCss = ''
  for (const id of EXPECTED_THEMES) {
    test(`baseline screenshot: ${id}`, async () => {
      previousCss = await applyThemeAndSettle(app, page, id, previousCss)
      await scrollEditorTo(page, 'top')
      await expect(page).toHaveScreenshot(`${id}.png`, { animations: 'disabled' })
      await scrollEditorTo(page, 'bottom')
      await expect(page).toHaveScreenshot(`${id}-bottom.png`, { animations: 'disabled' })
    })
  }
})
