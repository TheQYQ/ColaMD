import { describe, it, expect, beforeEach, vi } from 'vitest'

// `addThemeStyle` was the highest-complexity function in the desktop package
// (a 33-case switch, complexity 43) and had no unit coverage at all — the two
// existing theme specs cover `addCommonStyle`/`setEditorWidth` and the launch
// background colour. Turning the switch into a table is only safe if the table
// is pinned, so this spec covers: the id set, that every id maps to a generator,
// the injection reuses one <style> element, unknown ids leave it alone, custom
// themes still apply, and the CodeMirror skin follows the theme. Stylesheet
// *content* is not asserted — see the note inside the generator test for why.

// theme.ts transitively imports `@/config`, whose first line reads
// `window.path.sep` at module-load time.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

vi.mock('@/util/themeRegistry', () => ({
  isCustomTheme: (theme: string) => theme.startsWith('custom:'),
  getCustomTheme: (theme: string) =>
    theme === 'custom:missing' ? null : { id: theme, type: 'dark', name: 'Custom' }
}))

vi.mock('@/util/themeMarket', () => ({
  buildThemeCss: () => '.custom-root { --custom: 1; }'
}))

import { addThemeStyle, BUILT_IN_THEME_CSS } from '@/util/theme'
import { THEME_STYLE_ID, railscastsThemes, oneDarkThemes } from '@/config'

const styleHtml = (): string =>
  (document.querySelector(`#${THEME_STYLE_ID}`) as HTMLStyleElement | null)?.innerHTML ?? ''

const styleCount = (): number => document.querySelectorAll(`#${THEME_STYLE_ID}`).length

describe('built-in theme CSS table', () => {
  it('keys are exactly the theme ids the app offers', () => {
    // The realistic bug for a table keyed by id is a typo or a rename, which
    // would silently drop a theme's CSS — so the id set is pinned explicitly
    // rather than just counted.
    expect(Object.keys(BUILT_IN_THEME_CSS).sort()).toEqual(
      [
        'light',
        'dark',
        'material-dark',
        'ulysses',
        'graphite',
        'one-dark',
        'dracula',
        'nord',
        'catppuccin-mocha',
        'gruvbox-dark',
        'tokyo-night',
        'tokyo-night-storm',
        'solarized-dark',
        'ayu-dark',
        'ayu-mirage',
        'everforest-dark',
        'rose-pine',
        'rose-pine-moon',
        'monokai-pro',
        'synthwave-84',
        'horizon-dark',
        'palenight',
        'oxocarbon-dark',
        'kanagawa',
        'nightfox',
        'cyberdream',
        'catppuccin-latte',
        'gruvbox-light',
        'tokyo-night-light',
        'solarized-light',
        'ayu-light',
        'everforest-light',
        'rose-pine-dawn'
      ].sort()
    )
  })

  it('maps every id to a generator, and the inline override survives', () => {
    // The generators return the *empty string* here: their CSS arrives through
    // `.css` imports, which vitest does not process by default. Asserting the
    // shape (and the one theme whose CSS is written inline) is what is real in
    // a unit run; the actual stylesheet content is covered by the E2E theme
    // specs, which run in the built renderer.
    for (const [theme, build] of Object.entries(BUILT_IN_THEME_CSS)) {
      expect(typeof build, theme).toBe('function')
      expect(typeof build(), theme).toBe('string')
    }
    expect(BUILT_IN_THEME_CSS.light()).toContain('--link-color')
  })

  it('keys are the theme ids the preferences store uses', () => {
    // The dark/light CodeMirror groups must stay subsets of the table, or a
    // theme would get a CodeMirror skin with no CSS behind it.
    for (const theme of [...oneDarkThemes, ...railscastsThemes]) {
      expect(BUILT_IN_THEME_CSS[theme], theme).toBeDefined()
    }
  })
})

describe('addThemeStyle', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.className = ''
  })

  it('wraps the theme CSS in a print guard and adds dark chrome', () => {
    addThemeStyle('dark')

    expect(styleHtml()).toContain('@media not print')
    expect(document.body.classList.contains('dark')).toBe(true)
  })

  it('reuses the one style element across theme changes', () => {
    addThemeStyle('dark')
    const darkCss = styleHtml()
    addThemeStyle('light')

    expect(styleCount()).toBe(1)
    expect(styleHtml()).not.toBe(darkCss)
    expect(document.body.classList.contains('dark')).toBe(false)
  })

  it('leaves an unknown theme id without any CSS', () => {
    addThemeStyle('no-such-theme')

    expect(styleCount()).toBe(1)
    expect(styleHtml()).toBe('')
  })

  it('points CodeMirror at the skin matching the theme', () => {
    const cm = document.createElement('div')
    cm.className = 'CodeMirror cm-s-default'
    document.body.appendChild(cm)

    addThemeStyle('one-dark')
    expect(cm.classList.contains('cm-s-one-dark')).toBe(true)
    expect(cm.classList.contains('cm-s-default')).toBe(false)

    addThemeStyle(railscastsThemes[0])
    expect(cm.classList.contains('cm-s-railscasts')).toBe(true)
    expect(cm.classList.contains('cm-s-one-dark')).toBe(false)

    addThemeStyle('light')
    expect(cm.classList.contains('cm-s-default')).toBe(true)
    expect(cm.classList.contains('cm-s-railscasts')).toBe(false)
  })

  it('applies an installed custom theme and treats it as dark', () => {
    addThemeStyle('custom:midnight')

    expect(styleHtml()).toContain('@media not print')
    expect(styleHtml()).toContain('.custom-root')
    expect(document.body.classList.contains('dark')).toBe(true)
  })

  it('does not clear the style element when a custom id has no manifest', () => {
    addThemeStyle('light')
    const before = styleHtml()

    addThemeStyle('custom:missing')
    expect(styleHtml()).toBe(before)
    expect(document.body.classList.contains('dark')).toBe(false)
  })
})
