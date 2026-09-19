import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAvailableDictionaries } from '../../../src/main/spellchecker'

// `isSpellCheckerEnabled` is a method, not a property — line 31 of the same
// module calls it as one. Read without `()`, the guard was always truthy, so a
// broken spellchecker reported a fabricated dictionary list instead of warning
// and returning nothing.

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

// Pin the platform: on macOS the function returns [] by design, which would
// make the availability assertion below pass for the wrong reason.
vi.mock('../../../src/main/config', () => ({
  isOsx: false,
  isWindows: true,
  isLinux: false
}))

interface FakeSession {
  isSpellCheckerEnabled: () => boolean
  availableSpellCheckerLanguages: string[]
}

const fakeWindow = (session: FakeSession) =>
  ({ webContents: { session } }) as unknown as Parameters<typeof getAvailableDictionaries>[0]

describe('spellchecker availability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns and returns nothing when the spell checker is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = getAvailableDictionaries(
      fakeWindow({ isSpellCheckerEnabled: () => false, availableSpellCheckerLanguages: ['en-US'] })
    )

    expect(result).toEqual([])
    expect(warn).toHaveBeenCalledWith('Spell Checker not available but dictionaries requested.')
  })

  it('lists the session languages when the spell checker is available', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = getAvailableDictionaries(
      fakeWindow({
        isSpellCheckerEnabled: () => true,
        availableSpellCheckerLanguages: ['en-US', 'de-DE']
      })
    )

    expect(result).toEqual(['en-US', 'de-DE'])
    expect(warn).not.toHaveBeenCalled()
  })
})
