import bus from '@/bus'

// mitt types a handler as `(event: unknown) => void`. The editor's handlers
// declare their payload concretely and with different arities, so `never` in the
// parameter position -- which is assignable to every parameter type -- lets one
// table hold all of them without reaching for `any`. Each handler stays
// type-checked where it is defined.
export type EditorBusHandler = (...args: never[]) => unknown

export type EditorBusHandlers = Record<string, EditorBusHandler>

/**
 * Subscribe and unsubscribe the editor's bus events as ONE set: both directions
 * take the same object, so registering a name without the matching teardown is
 * no longer expressible -- which is exactly the mistake two hand-written lists
 * of thirty-one lines each could drift apart on.
 */
export function bindEditorBus(handlers: EditorBusHandlers): void {
  for (const [name, handler] of Object.entries(handlers)) {
    bus.on(name, handler as (event: unknown) => void)
  }
}

export function unbindEditorBus(handlers: EditorBusHandlers): void {
  for (const [name, handler] of Object.entries(handlers)) {
    bus.off(name, handler as (event: unknown) => void)
  }
}
