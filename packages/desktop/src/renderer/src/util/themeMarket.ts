import { sanitize, PREVIEW_DOMPURIFY_CONFIG } from './dompurify'

/**
 * ColaMD Theme Package format (.colamd-theme)
 *
 * A `.colamd-theme` file is a single JSON document containing metadata and
 * CSS. It is intentionally plain JSON (not a zip or binary blob) so that
 * theme authors can hand-edit it, and so the renderer can validate it
 * without unpacking or executing any code.
 */

export type ThemeType = 'light' | 'dark'

/** Maximum allowed size (bytes) for an imported theme's CSS fields. */
export const MAX_CSS_BYTES = 256 * 1024 // 256 KiB per CSS field

/** Reserved IDs that collide with built-in themes or system use. */
const RESERVED_IDS = new Set(['light', 'dark', 'graphite', 'material-dark', 'ulysses', 'one-dark'])

/**
 * The on-disk manifest for a ColaMD theme package.
 *
 * `editorCss` is injected into the same `<style id="theme-style">` that
 * `addThemeStyle()` targets; `codeCss` (optional) is appended to the Prism.js
 * stylesheet for syntax highlighting. Both must be plain CSS — no `@import`,
 * no `url()` fetches, no `expression()` — validated by `validateTheme()`.
 */
export interface ColaMDThemeManifest {
  /** Format discriminator. Always 'colamd-theme' for valid packages. */
  format: 'colamd-theme'
  /** Manifest version. Currently 1. */
  version: 1
  /** Unique theme identifier (kebab-case, matches filename convention). */
  id: string
  /** Human-readable theme name shown in the UI. */
  name: string
  /** Theme author/creator. */
  author?: string
  /** Short description of the theme. */
  description?: string
  /** 'light' or 'dark' — controls body class selection on apply. */
  type: ThemeType
  /** Editor CSS: variables + rules applied via addThemeStyle(). */
  editorCss: string
  /** Optional Prism.js syntax highlighting CSS appended to the code theme. */
  codeCss?: string
}

/** A registered theme with persisted install metadata. */
export interface InstalledTheme {
  manifest: ColaMDThemeManifest
  /** Timestamp when the theme was installed. */
  installedAt: number
}

/** Thrown when theme validation fails. Carries a i18n key for the UI. */
export class ThemeValidationError extends Error {
  constructor(
    message: string,
    public readonly i18nKey: string
  ) {
    super(message)
    this.name = 'ThemeValidationError'
  }
}

const ID_PATTERN = /^[a-z][a-z0-9-]{1,48}$/

/**
 * `dangerousCssPatterns` enumerates CSS constructs that would let a theme
 * exfiltrate content or load external resources — an attacker who tricks a
 * user into installing a crafted `.colamd-theme` could otherwise ship editor
 * text to a remote server via `url()` or run arbitrary CSS via `expression()`.
 * We strip the malicious intent at import time by rejecting any CSS matching
 * these patterns before it ever reaches a `<style>` element.
 */
const dangerousCssPatterns = [
  /@import\s+url\s*\(/i,
  /url\s*\(\s*['"]?https?:/i,
  /url\s*\(\s*['"]?\/\//i,
  /expression\s*\(/i,
  /-moz-binding\s*:/i,
  /<script/i,
  /javascript\s*:/i
]

const hasDangerousCss = (css: string): boolean => {
  return dangerousCssPatterns.some((re) => re.test(css))
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates an untrusted theme manifest parsed from a `.colamd-theme` file.
 * Throws ThemeValidationError with an i18n key on the first check that fails.
 *
 * Checks performed:
 * 1. Format discriminator and version match.
 * 2. `id` is a safe kebab-case slug not colliding with built-ins.
 * 3. `name` is a non-empty string.
 * 4. `type` is 'light' or 'dark'.
 * 5. `editorCss` exists and stays under MAX_CSS_BYTES, with no dangerous
 *    CSS constructs (see dangerousCssPatterns).
 * 6. Optional `codeCss` same constraints as editorCss.
 */
export const validateTheme = (raw: unknown): ColaMDThemeManifest => {
  if (!isPlainObject(raw)) {
    throw new ThemeValidationError('Theme file is not a JSON object', 'themeMarket.error.notObject')
  }

  if (raw.format !== 'colamd-theme') {
    throw new ThemeValidationError(
      `Unknown format "${String(raw.format)}" — expected "colamd-theme"`,
      'themeMarket.error.unknownFormat'
    )
  }

  if (raw.version !== 1) {
    throw new ThemeValidationError(
      `Unsupported manifest version ${String(raw.version)}`,
      'themeMarket.error.unsupportedVersion'
    )
  }

  const id = raw.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new ThemeValidationError(
      `Theme id "${String(id)}" is invalid — must be kebab-case, 2-49 chars, starting with a letter`,
      'themeMarket.error.invalidId'
    )
  }
  if (RESERVED_IDS.has(id)) {
    throw new ThemeValidationError(
      `Theme id "${id}" collides with a built-in theme`,
      'themeMarket.error.reservedId'
    )
  }

  const name = raw.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ThemeValidationError('Theme name is required', 'themeMarket.error.missingName')
  }

  const type = raw.type
  if (type !== 'light' && type !== 'dark') {
    throw new ThemeValidationError(
      `Theme type must be "light" or "dark", got "${String(type)}"`,
      'themeMarket.error.invalidType'
    )
  }

  const editorCss = raw.editorCss
  if (typeof editorCss !== 'string' || editorCss.length === 0) {
    throw new ThemeValidationError('editorCss is required', 'themeMarket.error.missingEditorCss')
  }
  if (byteLengthUtf8(editorCss) > MAX_CSS_BYTES) {
    throw new ThemeValidationError(
      `editorCss exceeds ${MAX_CSS_BYTES} bytes`,
      'themeMarket.error.cssTooLarge'
    )
  }
  if (hasDangerousCss(editorCss)) {
    throw new ThemeValidationError(
      'editorCss contains disallowed CSS constructs',
      'themeMarket.error.dangerousCss'
    )
  }

  const codeCss = raw.codeCss
  if (codeCss !== undefined) {
    if (typeof codeCss !== 'string') {
      throw new ThemeValidationError('codeCss must be a string', 'themeMarket.error.invalidCodeCss')
    }
    if (byteLengthUtf8(codeCss) > MAX_CSS_BYTES) {
      throw new ThemeValidationError(
        `codeCss exceeds ${MAX_CSS_BYTES} bytes`,
        'themeMarket.error.cssTooLarge'
      )
    }
    if (hasDangerousCss(codeCss)) {
      throw new ThemeValidationError(
        'codeCss contains disallowed CSS constructs',
        'themeMarket.error.dangerousCss'
      )
    }
  }

  return {
    format: 'colamd-theme',
    version: 1,
    id,
    name: name.trim(),
    author: typeof raw.author === 'string' ? raw.author : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    type,
    editorCss,
    codeCss
  }
}

/** Validates and parses a `.colamd-theme` file from its JSON text. */
export const parseThemeJson = (json: string): ColaMDThemeManifest => {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ThemeValidationError('Theme file is not valid JSON', 'themeMarket.error.invalidJson')
  }
  return validateTheme(raw)
}

/** Serializes a manifest to pretty-printed JSON for export. */
export const serializeTheme = (manifest: ColaMDThemeManifest): string => {
  return JSON.stringify(manifest, null, 2)
}

const byteLengthUtf8 = (s: string): number => {
  // TextEncoder is available in both the renderer and modern browsers.
  return new TextEncoder().encode(s).length
}

/**
 * Builds the CSS string that `addThemeStyle()` would inject for a custom
 * theme. Combines `editorCss` and optional `codeCss` so the apply path stays
 * identical to built-in themes (a single innerHTML write on THEME_STYLE_ID).
 */
export const buildThemeCss = (manifest: ColaMDThemeManifest): string => {
  if (manifest.codeCss) {
    return manifest.editorCss + '\n' + manifest.codeCss
  }
  return manifest.editorCss
}

/** Sanitizes a theme name for safe use as a filename. */
export const themeFileName = (id: string): string => {
  return `${id}.colamd-theme`
}

/**
 * Strips any HTML tags from a string before displaying it in the UI —
 * theme metadata comes from untrusted `.colamd-theme` files. Used as a
 * fallback when the caller wants plain text.
 */
export const sanitizeThemeText = (value: string | undefined): string => {
  if (!value) return ''
  // sanitize() runs DOMPurify to strip HTML/JS from untrusted content.
  return sanitize(value, { ...PREVIEW_DOMPURIFY_CONFIG, ALLOWED_TAGS: [] })
}
