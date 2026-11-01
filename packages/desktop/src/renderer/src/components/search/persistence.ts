// Persists the find bar's three match options across sessions (#GUI-B2
// UX-06). They were component-local refs, so every restart reset them. Same
// best-effort localStorage persistence the export dialog uses
// (exportSettings/persistence.ts).

const SEARCH_OPTIONS_STORAGE_KEY = 'search-options'

export interface SearchOptions {
  isCaseSensitive: boolean
  isWholeWord: boolean
  isRegexp: boolean
}

export function loadSearchOptions(): SearchOptions {
  const defaults: SearchOptions = {
    isCaseSensitive: false,
    isWholeWord: false,
    isRegexp: false
  }
  try {
    const raw = localStorage.getItem(SEARCH_OPTIONS_STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? { ...defaults, ...(parsed as Partial<SearchOptions>) }
      : defaults
  } catch {
    return defaults
  }
}

export function saveSearchOptions(options: SearchOptions): void {
  try {
    localStorage.setItem(SEARCH_OPTIONS_STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Storage can be unavailable (private mode / quota); losing the toggle
    // state on restart is acceptable, breaking search is not.
  }
}
