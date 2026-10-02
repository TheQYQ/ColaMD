import { vi } from 'vitest'

// Main-process handler-level harness: lets a unit test load a real `src/main`
// module, capture the `typedHandle`/`typedOn` registrations it makes, and drive
// the captured handlers through the same `ipcMain.handle(channel, event, …)`
// surface a renderer invoke would hit — without booting Electron.
//
// Usage (see main-handler-harness.spec.ts):
//   vi.mock('electron', async () => {
//     const { electronCaptureMock } = await import('../mainHandlerHarness')
//     return electronCaptureMock()
//   })
// The dynamic import inside the async factory is what keeps the mock factory
// from referencing not-yet-initialized bindings (vitest hoists `vi.mock` above
// every import). The registry is a plain module-level object: the factory obtains
// it through the same dynamic import, so no `vi.hoisted` is needed (and vitest
// refuses to export hoisted bindings anyway).
//
// Scope note: this harness validates the registration + handler layer. It
// cannot answer questions about Electron's own APIs (a stubbed
// `session.removeWordFromSpellCheckerDictionary` only tests the stub) — see the
// spellchecker stop-loss record in PROJECT_GUIDE §15 for exactly that limit.

export const ipcRegistry = {
  handle: new Map<string, (...args: unknown[]) => unknown>(),
  on: new Map<string, (...args: unknown[]) => unknown>()
}

const fromWebContents = vi.fn()

export const fromWebContentsMock = fromWebContents

export const electronCaptureMock = (): Record<string, unknown> => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcRegistry.handle.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcRegistry.on.set(channel, handler)
    }),
    once: vi.fn(),
    emit: vi.fn()
  },
  BrowserWindow: { fromWebContents }
})

export const makeInvokeEvent = (sender?: unknown): { sender: unknown } => ({
  sender: sender ?? {}
})

/** Drive a captured `ipcMain.handle` handler; fails loudly when none registered. */
export const invokeHandle = async (
  channel: string,
  event: unknown,
  ...args: unknown[]
): Promise<unknown> => {
  const handler = ipcRegistry.handle.get(channel)
  if (!handler) {
    throw new Error(
      `no ipcMain.handle registered for "${channel}" — did the module under test load and register?`
    )
  }
  return handler(event, ...args)
}

/** Drive a captured `ipcMain.on` handler; fails loudly when none registered. */
export const emitOn = (channel: string, event: unknown, ...args: unknown[]): void => {
  const handler = ipcRegistry.on.get(channel)
  if (!handler) {
    throw new Error(
      `no ipcMain.on registered for "${channel}" — did the module under test load and register?`
    )
  }
  handler(event, ...args)
}

export const resetIpcRegistry = (): void => {
  ipcRegistry.handle.clear()
  ipcRegistry.on.clear()
  fromWebContents.mockReset()
}
