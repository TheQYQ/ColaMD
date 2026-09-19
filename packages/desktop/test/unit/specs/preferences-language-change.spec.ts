import { beforeEach, describe, expect, it, vi } from 'vitest'

// The preferences sidebar kept its translated search text in sync by polling
// window.__VUE_I18N__ once per second for the life of the window, because the
// watcher it meant to use was never written (its if-body was empty). src/i18n
// already turns the `language-changed` IPC broadcast into a bus event after
// resolving the new locale — the same channel the command palette and editor
// listen on — so no timer should exist and a bus event must refresh the text.

const stubRendererGlobals = (): void => {
  const ipcRenderer = {
    on: () => {},
    removeListener: () => {},
    send: () => {},
    sendSync: () => undefined,
    invoke: () => Promise.resolve(undefined),
    once: () => {}
  }
  window.electron = { ipcRenderer } as unknown as typeof window.electron
  window.__VUE_I18N__ = {
    global: { locale: { value: 'zh-CN' }, t: (key: string) => key }
  }
}

describe('preferences language change', () => {
  beforeEach(() => {
    // The module wires its listener at load time, so each case needs a fresh
    // instance rather than the cached one.
    vi.resetModules()
    stubRendererGlobals()
  })

  it('creates no polling timer', async() => {
    const interval = vi.spyOn(globalThis, 'setInterval')

    await import('@/prefComponents/sideBar/config')

    expect(interval).not.toHaveBeenCalled()
    interval.mockRestore()
  })

  it('re-notifies the sidebar when the language changes', async() => {
    // Same module graph as config's own `import bus`, which resetModules()
    // would otherwise split into a second emitter instance.
    const { default: bus } = await import('@/bus')
    await import('@/prefComponents/sideBar/config')

    const seen = vi.fn()
    window.addEventListener('languageChanged', seen)
    bus.emit('language-changed', 'zh-CN')

    expect(seen).toHaveBeenCalledTimes(1)
    window.removeEventListener('languageChanged', seen)
  })
})
