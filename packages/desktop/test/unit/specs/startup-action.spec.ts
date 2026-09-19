import { describe, expect, it } from 'vitest'
import schema from '../../../src/main/preferences/schema.json'
import defaults from '../../../static/preference.json'
import { START_UP_ACTIONS } from '@shared/types/preferences'
import { resolveStartupPlan } from '../../../src/main/utils/startupPlan'

// The startup action had three unrelated descriptions of the same value set:
// schema.json (the persisted contract), a renderer union that named a value
// nothing else uses and omitted two the UI can actually store, and an if-chain
// in App.ready(). resolveStartupPlan is now the single place that must answer
// for every stored value, and these tests hold it to the schema.

const SOURCES = { defaultDirectoryToOpen: '/default/dir', lastOpenedFolder: '/last/folder' }

// Hand-derived, not read back from production code: this is the table the
// schema and resolveStartupPlan are checked against.
const CASES: Array<[string, ReturnType<typeof resolveStartupPlan>]> = [
  ['blank', { kind: 'none' }],
  ['restoreAll', { kind: 'restore' }],
  ['folder', { kind: 'open', path: '/default/dir' }],
  ['openLastFolder', { kind: 'open', path: '/last/folder' }]
]

describe('startup action', () => {
  it('maps every stored action to exactly one plan', () => {
    for (const [action, want] of CASES) {
      expect(resolveStartupPlan(action, SOURCES)).toEqual(want)
    }
  })

  it('covers exactly the values the schema allows', () => {
    const stored = CASES.map(([action]) => action)
    expect([...START_UP_ACTIONS].sort()).toEqual(stored.sort())
    // schema.json's root *is* the property map (no `properties` wrapper).
    const { enum: enumValues } = (schema as unknown as Record<string, { enum: string[] }>)
      .startUpAction
    expect([...enumValues].sort()).toEqual([...START_UP_ACTIONS].sort())
  })

  it('falls back to no plan when the referenced folder is missing', () => {
    expect(resolveStartupPlan('folder', {})).toEqual({ kind: 'none' })
    expect(resolveStartupPlan('openLastFolder', {})).toEqual({ kind: 'none' })
    // restoreAll does not depend on either source, so it still restores.
    expect(resolveStartupPlan('restoreAll', {})).toEqual({ kind: 'restore' })
  })

  it('treats an unknown or unmigrated value as no plan, never as a restore', () => {
    expect(resolveStartupPlan('lastState', SOURCES)).toEqual({ kind: 'none' })
    expect(resolveStartupPlan('', SOURCES)).toEqual({ kind: 'none' })
    expect(resolveStartupPlan(undefined, SOURCES)).toEqual({ kind: 'none' })
  })

  it('ships a default that the schema accepts', () => {
    expect(START_UP_ACTIONS).toContain(defaults.startUpAction)
  })
})
