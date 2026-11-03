// PERF-05 (#GUI-B6): the 56 theme CSS files used to be `?inline`-imported
// statically, putting ~550KB of CSS strings into the entry bundle while only
// one theme is ever active. They now load through Vite's glob (non-eager), so
// each file sits in its own tiny async chunk and the active theme fetches just
// its two files (theme + matching Prism) on first use.
//
// `light` is not a file: it is a two-variable reset evaluated inline.

import { SHARED_KEBAB_ALIASES, SHARED_THEME_PATCHES } from './sharedThemePatches'

const themeLoaders = import.meta.glob<string>('../assets/themes/*.theme.css', {
  query: '?inline',
  import: 'default'
}) as Record<string, () => Promise<string>>

const prismLoaders = import.meta.glob<string>('../assets/themes/prismjs/*.theme.css', {
  query: '?inline',
  import: 'default'
}) as Record<string, () => Promise<string>>

const THEME_DIR = '../assets/themes/'
const PRISM_DIR = '../assets/themes/prismjs/'

const loadThemeFile = async (name: string): Promise<string> => {
  const loader = themeLoaders[`${THEME_DIR}${name}.theme.css`]
  if (!loader) throw new Error(`Unknown built-in theme asset: ${name}`)
  return loader()
}

const loadPrismFile = async (name: string): Promise<string> => {
  const loader = prismLoaders[`${PRISM_DIR}${name}.theme.css`]
  // #125: returning '' here used to make a missing highlight file silent — the
  // theme still applied, just without syntax colors. `?inline` imports failed
  // the build before PERF-05, so restore that signal at the one place the
  // pairing can go missing. `theme-prism-pairing.spec.ts` also pins the table
  // against the asset directory without needing the CSS chunks to load.
  if (!loader) throw new Error(`Theme "${name}" has no matching Prism highlight file`)
  return loader()
}

/** Theme key -> its Prism highlight theme. `material-dark` shares `dark`'s. */
const PRISM_PAIR: Readonly<Record<string, string>> = Object.freeze({
  dark: 'dark',
  graphite: 'graphite',
  'material-dark': 'dark',
  'one-dark': 'one-dark',
  ulysses: 'ulysses',
  dracula: 'dracula',
  nord: 'nord',
  'catppuccin-mocha': 'catppuccin-mocha',
  'gruvbox-dark': 'gruvbox-dark',
  'tokyo-night': 'tokyo-night',
  'tokyo-night-storm': 'tokyo-night-storm',
  'solarized-dark': 'solarized-dark',
  'ayu-dark': 'ayu-dark',
  'ayu-mirage': 'ayu-mirage',
  'everforest-dark': 'everforest-dark',
  'rose-pine': 'rose-pine',
  'rose-pine-moon': 'rose-pine-moon',
  'monokai-pro': 'monokai-pro',
  'synthwave-84': 'synthwave-84',
  'horizon-dark': 'horizon-dark',
  palenight: 'palenight',
  'oxocarbon-dark': 'oxocarbon-dark',
  kanagawa: 'kanagawa',
  nightfox: 'nightfox',
  cyberdream: 'cyberdream',
  'catppuccin-latte': 'catppuccin-latte',
  'gruvbox-light': 'gruvbox-light',
  'tokyo-night-light': 'tokyo-night-light',
  'solarized-light': 'solarized-light',
  'ayu-light': 'ayu-light',
  'everforest-light': 'everforest-light',
  'rose-pine-dawn': 'rose-pine-dawn'
})

export const getBuiltInThemeCss = async (key: string): Promise<string> => {
  const prism = PRISM_PAIR[key]
  if (!prism) throw new Error(`Unknown built-in theme: ${key}`)
  const [theme, highlight] = await Promise.all([loadThemeFile(key), loadPrismFile(prism)])
  // Sheet order is load-bearing (see sharedThemePatches.ts): prism first so
  // the shared patch layer beats its code-block background by position, the
  // shared layer next, and the theme's own :root + appendix last so a theme
  // can still override the shared rules.
  return `${highlight}\n${SHARED_KEBAB_ALIASES}\n${SHARED_THEME_PATCHES}\n${theme}`
}

// Original themes
export const light = async (): Promise<string> =>
  `${SHARED_THEME_PATCHES}\n:root {\n  --link-color: var(--linkColor);\n  --blockquote-border-color: var(--blockquoteBorderColor);\n}`

export interface ThemePreviewMeta {
  text: string
  background: string
  accent: string
}

const previewMetaCache = new Map<string, ThemePreviewMeta | null>()

// DS-09 (GUI-SA-2): the theme picker's preview cards read their {text,
// background, accent} triple from the theme table itself, replacing ~90
// hand-maintained hexes that had drifted from the real palettes. Returns null
// for ids without a derivable table (custom themes) so the consumer falls
// back to the current-window vars — the pre-existing rendering.
export const getThemePreviewMeta = async (id: string): Promise<ThemePreviewMeta | null> => {
  if (previewMetaCache.has(id)) return previewMetaCache.get(id) ?? null
  let meta: ThemePreviewMeta | null = null
  if (id === 'light') {
    // light has no file; keep in sync with the :root defaults in index.css.
    meta = { text: '#1F2328', background: '#FCFCFC', accent: '#5B67C7' }
  } else {
    try {
      const css = await loadThemeFile(id)
      const root = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
      const pick = (name: string): string | null =>
        new RegExp(`--${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim() ?? null
      const text = pick('editorColor')
      const background = pick('editorBgColor')
      const accent = pick('themeColor')
      if (text && background && accent) meta = { text, background, accent }
    } catch {
      meta = null
    }
  }
  previewMetaCache.set(id, meta)
  return meta
}
