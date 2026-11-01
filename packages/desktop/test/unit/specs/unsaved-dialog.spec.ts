import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { computed, nextTick, ref } from 'vue'
import { loadSfcSetup } from '../sfcScriptHarness'

// #GUI-B1 UX-03 / A11Y-03. The unsaved-changes dialog is the only data-loss
// decision point in the app, and it used to ignore its IPC payload (so a close
// with three dirty files asked "save changes?" without saying which), had no
// initial focus (Enter did nothing), no focus trap (Tab wandered into the
// masked editor) and no focus restore. The component never had any test.
//
// The harness drives the real `<script setup>`; the template is not compiled
// here, so rendering is out of scope and the focus trap is exercised by
// stubbing `dialogEl` with a container over three real (focusable) buttons.

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/unsavedDialog/index.vue')

interface Bindings {
  visible: { value: boolean }
  fileNames: { value: string[] }
  dialogEl: { value: unknown }
  respond: (needSave: boolean) => void
  cancel: () => void
  __returned__?: Bindings
}

const boot = () => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => void>()
  const sent: Array<[string, unknown[]]> = []
  const mountedCallbacks: (() => unknown)[] = []
  // Every boot shares the real jsdom `document`, so the keydown listener must
  // be removed between tests — the unmount callback does exactly that.
  const unmountCallbacks: (() => unknown)[] = []

  ;(globalThis as unknown as { window: unknown }).window = {
    electron: {
      ipcRenderer: {
        on: (channel: string, handler: (...args: unknown[]) => void) => {
          ipcHandlers.set(channel, handler)
          return () => ipcHandlers.delete(channel)
        },
        send: (channel: string, ...args: unknown[]) => {
          sent.push([channel, args])
        }
      }
    }
  }

  const deps = {
    _defineComponent: (o: unknown) => o,
    ref,
    computed,
    nextTick,
    onMounted: (cb: () => unknown) => {
      mountedCallbacks.push(cb)
    },
    onBeforeUnmount: (cb: () => unknown) => {
      unmountCallbacks.push(cb)
    },
    useI18n: () => ({ t: (key: string) => key })
  }

  const setup = loadSfcSetup<Bindings>(vuePath, deps)
  const raw = setup({}, { expose: () => {} })
  const bindings = (raw.__returned__ ?? raw) as Bindings
  for (const cb of mountedCallbacks) cb()

  const showDialog = (names: string[]): void => {
    const handler = ipcHandlers.get('mt::show-unsaved-dialog')
    if (!handler) throw new Error('show-unsaved-dialog handler not registered')
    handler({}, names)
  }

  const pressKey = (key: string, init: KeyboardEventInit = {}): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  }

  pendingUnmount = () => {
    for (const cb of unmountCallbacks) cb()
  }

  return { bindings, sent, showDialog, pressKey }
}

// jsdom only reports an element as activeElement while it is attached.
const attachButton = (label: string): HTMLButtonElement => {
  const el = document.createElement('button')
  el.textContent = label
  document.body.appendChild(el)
  el.focus()
  return el
}

// Set by `boot()`, flushed in afterEach: every instance shares the real jsdom
// document, so a leaked keydown listener would answer later tests' keys.
let pendingUnmount: (() => void) | null = null

describe('unsaved dialog: payload, keyboard and focus management', () => {
  let attached: HTMLElement[] = []

  beforeEach(() => {
    document.title = ''
  })

  afterEach(() => {
    pendingUnmount?.()
    pendingUnmount = null
    for (const el of attached) el.remove()
    attached = []
  })

  it('consumes the file-name payload instead of dropping it', () => {
    const { bindings, showDialog } = boot()
    expect(bindings.visible.value).toBe(false)

    showDialog(['a.md', 'b.md', 'c.md'])
    expect(bindings.visible.value).toBe(true)
    expect(bindings.fileNames.value).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('restores focus to the previously focused element on cancel', () => {
    const { bindings, showDialog, sent } = boot()
    const origin = attachButton('editor')
    attached.push(origin)
    expect(document.activeElement).toBe(origin)

    showDialog(['a.md'])
    bindings.cancel()
    expect(bindings.visible.value).toBe(false)
    expect(document.activeElement).toBe(origin)
    expect(sent).toEqual([['mt::unsaved-dialog-response', [null]]])
  })

  it('answers { needSave: true } on Escape-free Enter when no button holds focus', () => {
    const { bindings, showDialog, sent, pressKey } = boot()
    showDialog(['a.md'])

    pressKey('Enter')
    expect(bindings.visible.value).toBe(false)
    expect(sent).toEqual([['mt::unsaved-dialog-response', [{ needSave: true }]]])
  })

  it('leaves Enter to the focused button instead of forcing save', () => {
    const { showDialog, sent, pressKey } = boot()
    showDialog(['a.md'])
    sent.length = 0

    const dontSave = attachButton('dontSave')
    attached.push(dontSave)
    dontSave.focus()
    pressKey('Enter')
    expect(sent).toEqual([])
  })

  it('traps Tab among the three dialog buttons', () => {
    const { bindings, showDialog, pressKey } = boot()
    showDialog(['a.md'])

    const buttons = ['save', 'dontSave', 'cancel'].map((label) => attachButton(label))
    attached.push(...buttons)
    bindings.dialogEl.value = {
      querySelectorAll: (selector: string) => (selector === 'button.dialog-btn' ? buttons : [])
    }

    pressKey('Tab')
    expect(document.activeElement).toBe(buttons[0])
    pressKey('Tab')
    expect(document.activeElement).toBe(buttons[1])
    pressKey('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(buttons[0])
    pressKey('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(buttons[2])
  })

  it('ignores keys while the dialog is hidden', () => {
    const { sent, pressKey } = boot()
    pressKey('Escape')
    pressKey('Enter')
    expect(sent).toEqual([])
  })
})
