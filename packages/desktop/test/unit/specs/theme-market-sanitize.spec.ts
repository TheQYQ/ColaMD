import { describe, expect, it } from 'vitest'

import { sanitizeThemeText } from '@/util/themeMarket'

// Theme metadata arrives from untrusted `.colamd-theme` files. The theme list
// renders it through Vue's escaped interpolation and HTML previews are
// sanitized inside the engine, so nothing in the UI calls this today — the
// spec pins the plain-text fallback any new renderer of that text is meant
// to use.
describe('themeMarket.sanitizeThemeText', () => {
  it('strips HTML tags while keeping the text', () => {
    expect(sanitizeThemeText('<b>bold</b> name')).toBe('bold name')
  })

  it('drops script elements together with their content', () => {
    expect(sanitizeThemeText('<script>alert(1)</script>Solarized')).toBe('Solarized')
  })

  it('keeps plain text intact', () => {
    expect(sanitizeThemeText('Solarized Dark')).toBe('Solarized Dark')
  })

  it('maps missing values to an empty string', () => {
    expect(sanitizeThemeText(undefined)).toBe('')
    expect(sanitizeThemeText('')).toBe('')
  })
})
