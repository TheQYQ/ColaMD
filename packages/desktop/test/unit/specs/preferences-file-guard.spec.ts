import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compilePreferencesValidator,
  quarantineInvalidPreferencesFile
} from 'main_renderer/preferences/preferencesFileGuard'

// The guard mirrors conf's load-time verdict (JSON.parse + schema validation
// with the same ajv options), so the test schema only needs one typed key to
// distinguish "valid" from "schema violation".
// Same flat per-key shape as main/preferences/schema.json (conf wraps it
// into an object schema internally).
const schema = {
  autoSave: { type: 'boolean' }
}

const validate = compilePreferencesValidator(schema)

const dirs: string[] = []
function makeFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-guard-'))
  dirs.push(dir)
  const filePath = path.join(dir, 'preferences.json')
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('quarantineInvalidPreferencesFile', () => {
  it('leaves a valid file alone', () => {
    const filePath = makeFile('{"autoSave": true}')
    const result = quarantineInvalidPreferencesFile(filePath, validate)
    expect(result.quarantined).toBe(false)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('reports no quarantine for a missing file', () => {
    const filePath = path.join(os.tmpdir(), `pref-guard-missing-${Date.now()}.json`)
    const result = quarantineInvalidPreferencesFile(filePath, validate)
    expect(result.quarantined).toBe(false)
  })

  it('quarantines corrupt JSON and preserves the original beside it', () => {
    const filePath = makeFile('{ autoSave: tru')
    const result = quarantineInvalidPreferencesFile(filePath, validate)
    expect(result.quarantined).toBe(true)
    expect(result.reason).toBe('json-parse')
    const backupPath = result.backupPath
    expect(backupPath).toBeDefined()
    expect(fs.readFileSync(backupPath as string, 'utf8')).toBe('{ autoSave: tru')
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('quarantines schema-violating values and preserves the original beside it', () => {
    const filePath = makeFile('{"autoSave": "yes"}')
    const result = quarantineInvalidPreferencesFile(filePath, validate)
    expect(result.quarantined).toBe(true)
    expect(result.reason).toBe('schema-violation')
    const schemaBackupPath = result.backupPath
    expect(schemaBackupPath).toBeDefined()
    expect(fs.existsSync(schemaBackupPath as string)).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })
})
