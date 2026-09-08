import { themes as builtInThemes } from '../prefComponents/theme/config'
import type { ThemeDescriptor } from '../prefComponents/theme/config'
import type { ColaMDThemeManifest, InstalledTheme } from './themeMarket'

/**
 * `themeRegistry` is the in-memory store of all known themes — built-in ones
 * (from config.ts) plus user-installed custom themes (from preferences). It is
 * the single source of truth for both the theme dropdown in preferences and the
 * `addThemeStyle()` dispatcher.
 *
 * Persistence is owned by the preferences store (`installedThemes`); this
 * module only manages the live map and exposes helpers.
 */

const customThemeMap = new Map<string, InstalledTheme>()

/** Resolves to all registered themes (built-in + custom) in a stable order. */
export const getAllThemes = (): ThemeDescriptor[] => {
  const builtins = builtInThemes.map((t): ThemeDescriptor => ({ name: t.name }))
  const customs = [...customThemeMap.values()].map(
    (t): ThemeDescriptor => ({
      name: t.manifest.id
    })
  )
  return [...builtins, ...customs]
}

/** Looks up a custom theme manifest by id. Returns undefined if it's a built-in. */
export const getCustomTheme = (id: string): ColaMDThemeManifest | undefined => {
  return customThemeMap.get(id)?.manifest
}

/** True when the id belongs to a user-installed theme. */
export const isCustomTheme = (id: string): boolean => {
  return customThemeMap.has(id)
}

/**
 * Registers (or updates) a custom theme from its manifest. Called after a
 * successful import. Returns the stored InstalledTheme for chaining.
 */
export const registerTheme = (manifest: ColaMDThemeManifest): InstalledTheme => {
  const entry: InstalledTheme = { manifest, installedAt: Date.now() }
  customThemeMap.set(manifest.id, entry)
  return entry
}

/**
 * Batch-registers themes from preferences on startup. Skips any whose
 * manifest is somehow invalid — better to lose a corrupt entry than crash the
 * renderer. (Should never happen because preferences are validated before
 * write, but defense in depth against hand-edited config files.)
 */
export const hydrateThemes = (themes: InstalledTheme[]): void => {
  customThemeMap.clear()
  for (const entry of themes) {
    if (entry.manifest && typeof entry.manifest.id === 'string') {
      customThemeMap.set(entry.manifest.id, entry)
    }
  }
}

/** Removes a custom theme from the registry. Returns true if it existed. */
export const unregisterTheme = (id: string): boolean => {
  return customThemeMap.delete(id)
}

/** Clears all custom themes (testing/cleanup). */
export const clearCustomThemes = (): void => {
  customThemeMap.clear()
}

/** Returns all installed custom themes as an array (for persistence). */
export const getInstalledThemes = (): InstalledTheme[] => {
  return [...customThemeMap.values()]
}
