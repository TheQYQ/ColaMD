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
}

const deferred = <T>(): Deferred<T> => {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
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

const makeConfigurator = (): KeybindingConfigurator =>
  new KeybindingConfigurator(new Map(DEFAULTS), new Map())

describe('keybinding save keeps edits made while the write is in flight (#round-6)', () => {
  it('does not clear the dirty flag for an edit made during the save', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    expect(kb.change('file.save', 'CmdOrCtrl+Shift+S')).toBe(true)
    expect(kb.isDirty).toBe(true)

    const first = ipc.next()
    const saving = kb.save()
    await Promise.resolve()

    // The user keeps editing while the write is on the wire.
    expect(kb.change('file.open-file', 'CmdOrCtrl+Shift+O')).toBe(true)
    expect(kb.isDirty).toBe(true)

    first.resolve(true)
    expect(await saving).toBe(true)

    // That edit is not in what was persisted...
    expect(ipc.saved[0].get('file.open-file')).toBeUndefined()
    // ...so the form must still read as dirty, otherwise the edit is unreachable.
    expect(kb.isDirty).toBe(true)
  })

  it('persists the late edit on the next save (the fix keeps it recoverable)', async () => {
    const ipc = installIpc()
    const kb = makeConfigurator()

    kb.change('file.save', 'CmdOrCtrl+Shift+S')
    const first = ipc.next()
    const saving = kb.save()
    await Promise.resolve()
    kb.change('file.open-file', 'CmdOrCtrl+Shift+O')
    first.resolve(true)
    await saving
    expect(kb.isDirty).toBe(true)

    const second = ipc.next()
    const savingAgain = kb.save()
    second.resolve(true)
    expect(await savingAgain).toBe(true)

    // Now both edits are on the wire, and the form is clean.
    expect(ipc.saved[1].get('file.open-file')).toBe('CmdOrCtrl+Shift+O')
    expect(ipc.saved[1].get('file.save')).toBe('CmdOrCtrl+Shift+S')
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
})
