// A11Y-01 (#GUI-B8): div-based controls carry role="button" + tabindex="0";
// this pairs them with the keyboard activation a native <button> would have
// for free. Bind as `@keydown="activateOnEnterOrSpace"` — the handler reads
// `currentTarget`, so it works no matter which descendant has focus.
export const activateOnEnterOrSpace = (event: KeyboardEvent): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  target.click()
}
