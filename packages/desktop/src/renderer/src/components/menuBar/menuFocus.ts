export interface MenuRow {
  type?: string
  enabled?: boolean
}

const isSeparator = (row: MenuRow): boolean => row.type === 'separator'

export const nextFocusableIndex = (items: MenuRow[], from: number, delta: 1 | -1): number => {
  const count = items.length
  if (count === 0) return -1
  // At most one full lap: a list of nothing but separators has nowhere to send
  // the caret, and an unbounded `while (isSeparator)` would spin on it forever.
  for (let step = 1; step <= count; step++) {
    const next = (((from + delta * step) % count) + count) % count
    if (!isSeparator(items[next])) return next
  }
  return -1
}

export const firstFocusableIndex = (items: MenuRow[]): number =>
  items.findIndex((row) => !isSeparator(row))

export const lastFocusableIndex = (items: MenuRow[]): number => {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!isSeparator(items[i])) return i
  }
  return -1
}
