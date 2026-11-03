import { describe, expect, it, vi } from 'vitest'

// Round 6 of the stability audit: `KeybindingConfigurator.save()` captures the map
// to persist, awaits the IPC, and then clears the dirty flag unconditionally:
//
//   async save(): Promise<boolean> {
//     if (!this.isDirty) return true
//     const userKeybindings = this._getUserKeybindingMap()
//     const result = await invoke('mt::keybinding-save-user-keybindings', userKeybindings)
//     if (result) { this.isDirty = false; return true }
//     return false
//   }
//
// `change()` sets `isDirty = true` when the user edits a binding. An edit made
// while the write is in flight therefore loses twice over: it is not in
// `userKeybindings` (that map was built before the await), and the late
// `isDirty = false` then declares the form clean 鈥?so closing the preferences
// window stops warning and the edit is never written. Silent loss.
//
// No aliasing saves it here: `_getUserKeybindingMap()` returns a fresh `Map` on
// every call, so the map that went over IPC cannot grow behind our back.
//
// The IPC is settled by hand, so "edit while saving" is constructed, not timed.

vi.mock('common/keybinding', () => ({
  isEqualAccelerator: (a: string, b: string) => a === b
}))
vi.mock('@/commands/descriptions', () => ({
  default: (id: string) => id
}))
vi.mock('@/util', () => ({ isOsx: false }))

import KeybindingConfigurator from '@/prefComponents/keybindings/KeybindingConfigurator'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void
  let fail!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, resolve: settle, reject: fail }
}

const DEFAULTS = new Map<string, string>([
  ['file.save', 'CmdOrCtrl+S'],
  ['file.open-file', 'CmdOrCtrl+O'],
  ['edit.undo', 'CmdOrCtrl+Z']
])

// One IPC stub per test: every invoke records the map that actually went over the
// wire and hands back a deferred the test settles by hand. `next()` arms the
// following invoke, so a test that saves twice does not have to re-patch the stub
// in between. `saved` is per-test 鈥?a module-level log would make the indices in
// one test depend on how many saves the earlier tests did.
const installIpc = (): { next: () => Deferred<boolean>; saved: Map<string, string>[] } => {
  let armed: Deferred<boolean> = deferred<boolean>()
  const saved: Map<string, string>[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: (_channel: string, userKeybindings: Map<string, string>) => {
          saved.push(new Map(userKeybindings))
          return armed.promise
        }
      }
    }
  }
  return {
    saved,
    next: () => {
      const d = deferred<boolean>()
      armed = d
      return d
    }
  }
}

const makeConfigurator = (onSaveError?: () => void): KeybindingConfigurator =>
  new KeybindingConfigurator(new Map(DEFAULTS), new Map(), { onSaveError })

describe('keybinding save: auto-save keeps late edits (#round-6 lineage, GUI-B10 model)', () => {
  it('auto-save persists an edit made while a write is in flight and ends clean', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    // Arm BEFORE each change: the auto-save inside change() awaits the armed
    // deferred, and `next()` re-arms so the two writes settle independently.
    const first = ipc.next()
    expect(kb.change('file.save', 'CmdOrCtrl+Shift+S')).toBe(true)
    expect(kb.isDirty).toBe(true)
    await Promise.resolve()

    const second = ipc.next()
    expect(kb.change('file.open-file', 'CmdOrCtrl+Shift+O')).toBe(true)
    expect(kb.isDirty).toBe(true)

    first.resolve(true) // the first write lands, without the late edit
    await Promise.resolve()

    second.resolve(true) // the follow-up write lands, with the late edit
    await Promise.resolve()

    // The late edit IS in what was persisted (by the follow-up save)...
    expect(ipc.saved[0].get('file.open-file')).toBeUndefined()
    expect(ipc.saved[1].get('file.open-file')).toBe('CmdOrCtrl+Shift+O')
    // ...so the form ends clean instead of warning on close.
    expect(kb.isDirty).toBe(false)
  })

  it('does not let a stale write clear the flag (revision guard intact)', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    const first = ipc.next()
    expect(kb.change('file.save', 'CmdOrCtrl+Shift+S')).toBe(true)
    await Promise.resolve()

    const second = ipc.next()
    expect(kb.change('file.open-file', 'CmdOrCtrl+Shift+O')).toBe(true)
    await Promise.resolve()

    first.resolve(true) // the stale write lands (without the late edit)
    await Promise.resolve()
    // The revision guard keeps the form dirty until the follow-up save lands.
    expect(ipc.saved[0].get('file.open-file')).toBeUndefined()
    expect(kb.isDirty).toBe(true)

    second.resolve(true)
    await Promise.resolve()
    expect(ipc.saved[1].get('file.open-file')).toBe('CmdOrCtrl+Shift+O')
    expect(kb.isDirty).toBe(false)
  })

  it('still clears the dirty flag when nothing was edited during the save (positive control)', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    kb.change('file.save', 'CmdOrCtrl+Shift+S')
    const first = ipc.next()
    const saving = kb.save()
    await Promise.resolve()

    first.resolve(true)
    expect(await saving).toBe(true)

    expect(ipc.saved[0].get('file.save')).toBe('CmdOrCtrl+Shift+S')
    expect(kb.isDirty).toBe(false)
  })

  it('keeps the flag dirty when the write itself failed', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    kb.change('file.save', 'CmdOrCtrl+Shift+S')
    const first = ipc.next()
    const saving = kb.save()
    await Promise.resolve()

    first.resolve(false)
    expect(await saving).toBe(false)
    expect(kb.isDirty).toBe(true)
  })

  // #130: `change()` fires the write without awaiting it. A rejected invoke
  // (main handler threw) used to become an unhandled rejection the user never
  // saw; the injected hook now receives both failure shapes.
  it('routes a rejected auto-save through the failure hook', async () => {
    const ipc = installIpc()
    const onSaveError = vi.fn()
    const kb = makeConfigurator(onSaveError)

    const armed = ipc.next()
    expect(kb.change('file.save', 'CmdOrCtrl+Shift+S')).toBe(true)
    await Promise.resolve()

    armed.reject(new Error('main handler threw'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onSaveError).toHaveBeenCalledTimes(1)
    expect(kb.isDirty).toBe(true)
  })

  it('routes a false auto-save result through the same hook', async () => {
    const ipc = installIpc()
    const onSaveError = vi.fn()
    const kb = makeConfigurator(onSaveError)

    const armed = ipc.next()
    expect(kb.change('file.save', 'CmdOrCtrl+Shift+S')).toBe(true)
    await Promise.resolve()

    armed.resolve(false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onSaveError).toHaveBeenCalledTimes(1)
  })
})
