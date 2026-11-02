import { describe, expect, it } from 'vitest'

import {
  firstFocusableIndex,
  lastFocusableIndex,
  nextFocusableIndex
} from '@/components/menuBar/menuFocus'

// SC-1 (#GUI-SC1): the dropdown's arrow-key walk. Separators are decoration and
// must not stop on them; every real row does, including disabled ones (WAI-ARIA
// keeps disabled menu items focusable so an AT user can learn the option exists
// — activation is what they cannot do, and `onRowClick` already refuses).

interface Row {
  type?: string
  enabled?: boolean
}

const rows = (...defs: Array<Partial<Row>>): Row[] => defs.map((d) => ({ ...d }))

describe('menuFocus nextFocusableIndex', () => {
  it('steps to the next row when nothing is in the way', () => {
    const items = rows({}, {}, {})
    expect(nextFocusableIndex(items, 0, 1)).toBe(1)
  })

  it('skips a separator when stepping down', () => {
    const items = rows({}, { type: 'separator' }, {})
    expect(nextFocusableIndex(items, 0, 1)).toBe(2)
  })

  it('wraps from the last row to the first when stepping down', () => {
    const items = rows({}, {}, {})
    expect(nextFocusableIndex(items, 2, 1)).toBe(0)
  })

  it('wraps from the first row to the last when stepping up', () => {
    const items = rows({}, {}, {})
    expect(nextFocusableIndex(items, 0, -1)).toBe(2)
  })

  it('reports no destination rather than spinning when every row is a separator', () => {
    const items = rows({ type: 'separator' }, { type: 'separator' })
    expect(nextFocusableIndex(items, 0, 1)).toBe(-1)
  })

  it('still lands on a disabled row, because only activation is denied', () => {
    // Pins the WAI-ARIA choice rather than proving new capability: skipping
    // disabled rows would hide options an AT user cannot otherwise learn exist.
    // `onRowClick` is what refuses to actuate them.
    const items = rows({}, { enabled: false }, {})
    expect(nextFocusableIndex(items, 0, 1)).toBe(1)
  })

  it('finds the first row for Home, past a leading separator', () => {
    const items = rows({ type: 'separator' }, {}, {})
    expect(firstFocusableIndex(items)).toBe(1)
  })

  it('finds the last row for End, before a trailing separator', () => {
    const items = rows({}, {}, { type: 'separator' })
    expect(lastFocusableIndex(items)).toBe(1)
  })

  it('reports nothing at all for a list of only separators', () => {
    const items = rows({ type: 'separator' })
    expect(firstFocusableIndex(items)).toBe(-1)
    expect(lastFocusableIndex(items)).toBe(-1)
  })
})
