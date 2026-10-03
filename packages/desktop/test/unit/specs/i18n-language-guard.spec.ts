import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The language string is spliced into a locale file path; before the guard a
// renderer-forged `../x` could read any .json on disk through the fallback
// logic. common/i18n resolves the dev locale path against process.cwd(), so
// the tests pin NODE_ENV=development to read the real static/locales.

const previousEnv = process.env.NODE_ENV

beforeAll(() => {
  process.env.NODE_ENV = 'development'
})

afterAll(() => {
  process.env.NODE_ENV = previousEnv
})

describe('i18n locale whitelist', () => {
  it('still loads a real locale', async () => {
    const { loadTranslations } = await import('common/i18n')
    expect(loadTranslations('zh-CN')).toBeTruthy()
    expect(loadTranslations('en')).toBeTruthy()
  })

  it('rejects traversal payloads and falls back to en', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { loadTranslations } = await import('common/i18n')
      expect(loadTranslations('../package')).toEqual(loadTranslations('en'))
      expect(loadTranslations('zh-CN/../../package')).toEqual(loadTranslations('en'))
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected invalid language'))
    } finally {
      errorSpy.mockRestore()
    }
  })
})
