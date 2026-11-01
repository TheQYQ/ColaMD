import {
  THEME_STYLE_ID,
  COMMON_STYLE_ID,
  DEFAULT_CODE_FONT_FAMILY,
  oneDarkThemes,
  railscastsThemes
} from '../config'
import { getCustomTheme, isCustomTheme } from './themeRegistry'
import { buildThemeCss } from './themeMarket'
import { getBuiltInThemeCss, light } from './themeColor'
import { isLinux } from './index'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ORIGINAL_THEME = '#409EFF'

const patchTheme = (css: string): string => {
  return `@media not print {\n${css}\n}`
}

const getEmojiPickerPatch = (): string => {
  return isLinux
    ? '.mu-emoji-picker section .emoji-wrapper .item span { font-family: sans-serif, "Noto Color Emoji"; }'
    : ''
}

// One entry per built-in theme: the theme's CSS loader. This table used to
// be a 33-case switch inside `addThemeStyle` (complexity 43 — the highest in
// the package); the cases differed only in which generator they called, so the
// whole thing is one lookup now. Since PERF-05 (#GUI-B6) the generators are
// async — each fetches its two `?inline` chunks on first use instead of the
// entry bundle carrying all 56 theme files. Adding a theme means adding a line
// here (and a pairing in themeColor.ts), and
// `test/unit/specs/theme-style-injection.spec.ts` pins that every key really
// produces CSS.
export const BUILT_IN_THEME_CSS: Readonly<Record<string, () => Promise<string>>> = {
  light: () => light(),
  dark: () => getBuiltInThemeCss('dark'),
  'material-dark': () => getBuiltInThemeCss('material-dark'),
  ulysses: () => getBuiltInThemeCss('ulysses'),
  graphite: () => getBuiltInThemeCss('graphite'),
  'one-dark': () => getBuiltInThemeCss('one-dark'),
  // New gogh themes - Dark
  dracula: () => getBuiltInThemeCss('dracula'),
  nord: () => getBuiltInThemeCss('nord'),
  'catppuccin-mocha': () => getBuiltInThemeCss('catppuccin-mocha'),
  'gruvbox-dark': () => getBuiltInThemeCss('gruvbox-dark'),
  'tokyo-night': () => getBuiltInThemeCss('tokyo-night'),
  'tokyo-night-storm': () => getBuiltInThemeCss('tokyo-night-storm'),
  'solarized-dark': () => getBuiltInThemeCss('solarized-dark'),
  'ayu-dark': () => getBuiltInThemeCss('ayu-dark'),
  'ayu-mirage': () => getBuiltInThemeCss('ayu-mirage'),
  'everforest-dark': () => getBuiltInThemeCss('everforest-dark'),
  'rose-pine': () => getBuiltInThemeCss('rose-pine'),
  'rose-pine-moon': () => getBuiltInThemeCss('rose-pine-moon'),
  'monokai-pro': () => getBuiltInThemeCss('monokai-pro'),
  'synthwave-84': () => getBuiltInThemeCss('synthwave-84'),
  'horizon-dark': () => getBuiltInThemeCss('horizon-dark'),
  palenight: () => getBuiltInThemeCss('palenight'),
  'oxocarbon-dark': () => getBuiltInThemeCss('oxocarbon-dark'),
  kanagawa: () => getBuiltInThemeCss('kanagawa'),
  nightfox: () => getBuiltInThemeCss('nightfox'),
  cyberdream: () => getBuiltInThemeCss('cyberdream'),
  // New gogh themes - Light
  'catppuccin-latte': () => getBuiltInThemeCss('catppuccin-latte'),
  'gruvbox-light': () => getBuiltInThemeCss('gruvbox-light'),
  'tokyo-night-light': () => getBuiltInThemeCss('tokyo-night-light'),
  'solarized-light': () => getBuiltInThemeCss('solarized-light'),
  'ayu-light': () => getBuiltInThemeCss('ayu-light'),
  'everforest-light': () => getBuiltInThemeCss('everforest-light'),
  'rose-pine-dawn': () => getBuiltInThemeCss('rose-pine-dawn')
}

// Installed `.colamd-theme` packages fall through the table above; they resolve
// here so they follow the same body-class and CodeMirror-class paths as
// built-ins. Returns whether the custom theme asked for dark chrome.
const applyCustomTheme = (theme: string, styleEle: HTMLStyleElement): boolean => {
  if (!isCustomTheme(theme)) return false
  const manifest = getCustomTheme(theme)
  if (!manifest) return false
  styleEle.innerHTML = patchTheme(buildThemeCss(manifest))
  return manifest.type === 'dark'
}

// Dark chrome: the body class drives the native-looking icons, and CodeMirror
// needs one of its three skins to match the editor.
const applyDarkChrome = (isDarkTheme: boolean, isCmOneDark: boolean, isCmRailscasts: boolean) => {
  document.body.classList.remove('dark')
  if (isDarkTheme) {
    document.body.classList.add('dark')
  }

  const cm = document.querySelector('.CodeMirror')
  if (!cm) return
  cm.classList.remove('cm-s-default')
  cm.classList.remove('cm-s-one-dark')
  cm.classList.remove('cm-s-railscasts')
  if (isCmOneDark) {
    cm.classList.add('cm-s-one-dark')
  } else if (isCmRailscasts) {
    cm.classList.add('cm-s-railscasts')
  } else {
    cm.classList.add('cm-s-default')
  }
}

// PERF-05: the CSS now arrives asynchronously, so two quick switches could
// otherwise land out of order (last-STARTED winning instead of last-requested).
let themeApplySeq = 0

export const addThemeStyle = async (theme: string): Promise<void> => {
  const seq = ++themeApplySeq
  const isCmRailscasts = railscastsThemes.includes(theme)
  const isCmOneDark = oneDarkThemes.includes(theme)
  let isDarkTheme = isCmOneDark || isCmRailscasts
  let themeStyleEle = document.querySelector(`#${THEME_STYLE_ID}`) as HTMLStyleElement | null
  if (!themeStyleEle) {
    themeStyleEle = document.createElement('style')
    themeStyleEle.id = THEME_STYLE_ID
    document.head.appendChild(themeStyleEle)
  }

  const buildCss = BUILT_IN_THEME_CSS[theme]
  if (buildCss) {
    const css = await buildCss()
    if (seq !== themeApplySeq) return
    themeStyleEle.innerHTML = patchTheme(css)
  }
  if (applyCustomTheme(theme, themeStyleEle)) {
    isDarkTheme = true
  }
  if (seq !== themeApplySeq) return

  applyDarkChrome(isDarkTheme, isCmOneDark, isCmRailscasts)
}

export const setEditorWidth = (value: string): void => {
  const EDITOR_WIDTH_STYLE_ID = 'editor-width'
  let result = ''
  if (value && /^[0-9]+(?:ch|px|%)$/.test(value)) {
    // Add 100px for the container's horizontal padding. Set both the legacy
    // camelCase var (source mode) and the kebab-case var the active
    // @muyajs/core engine reads for `.mu-container` max-width (issue #4828).
    const width = `calc(100px + ${value})`
    result = `:root { --editorAreaWidth: ${width}; --editor-area-width: ${width}; }`
  }
  let styleEle = document.querySelector(`#${EDITOR_WIDTH_STYLE_ID}`) as HTMLStyleElement | null
  if (!styleEle) {
    styleEle = document.createElement('style')
    styleEle.setAttribute('id', EDITOR_WIDTH_STYLE_ID)
    document.head.appendChild(styleEle)
  }

  styleEle.innerHTML = result
}

export interface CommonStyleOptions {
  codeFontFamily: string
  codeFontSize: number | string
  hideScrollbar?: boolean
  [key: string]: unknown
}

export const addCommonStyle = (options: CommonStyleOptions): void => {
  const { codeFontFamily, codeFontSize, hideScrollbar } = options
  let sheet = document.querySelector(`#${COMMON_STYLE_ID}`) as HTMLStyleElement | null
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = COMMON_STYLE_ID
    document.head.appendChild(sheet)
  }

  let scrollbarStyle = ''
  if (hideScrollbar) {
    scrollbarStyle = '::-webkit-scrollbar {display: none;}'
  }

  sheet.innerHTML = `${scrollbarStyle}
.CodeMirror {
font-family: ${codeFontFamily}, ${DEFAULT_CODE_FONT_FAMILY};
font-size: ${codeFontSize}px;
}

${getEmojiPickerPatch()}
`
}

export interface CustomStyleOptions {
  customCss?: string
  [key: string]: unknown
}

export const addCustomStyle = (options: CustomStyleOptions): void => {
  const { customCss } = options
  if (!customCss) return

  let customStyleEle = document.querySelector('#custom-styles') as HTMLStyleElement | null
  if (!customStyleEle) {
    customStyleEle = document.createElement('style')
    customStyleEle.id = 'custom-styles'
    document.head.appendChild(customStyleEle)
  }
  customStyleEle.innerHTML = customCss
}

export interface AddStylesOptions extends CommonStyleOptions {
  theme: string
}

// Append common sheet and theme at the end of head - order is important.
export const addStyles = async (options: AddStylesOptions): Promise<void> => {
  const { theme } = options
  await addThemeStyle(theme)
  addCommonStyle(options)
}
