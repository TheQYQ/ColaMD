// PERF-05 (#GUI-B6): the 56 theme CSS files used to be `?inline`-imported
// statically, putting ~550KB of CSS strings into the entry bundle while only
// one theme is ever active. They now load through Vite's glob (non-eager), so
// each file sits in its own tiny async chunk and the active theme fetches just
// its two files (theme + matching Prism) on first use.
//
// `light` is not a file: it is a two-variable reset evaluated inline.

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
  if (!loader) return ''
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
  return `${theme}\n${highlight}`
}

// Original themes
export const light = async (): Promise<string> =>
  ':root {\n  --link-color: var(--linkColor);\n  --blockquote-border-color: var(--blockquoteBorderColor);\n}'
