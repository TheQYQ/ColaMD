// Self-heal guard for the user preferences file (#18 round: settings-migration
// face). conf's `clearInvalidConfig` defaults to false, so a preferences.json
// that fails JSON.parse or schema validation throws from the Store
// constructor — and the app crash-loops on every launch until the file is
// deleted by hand. Quarantining the file (rename aside, contents preserved)
// lets startup proceed from defaults instead.

import fs from 'fs'
import Ajv, { type ValidateFunction } from 'ajv'
import ajvFormats from 'ajv-formats'

export interface PreferencesFileQuarantine {
  quarantined: boolean
  reason?: 'json-parse' | 'schema-violation'
  backupPath?: string
}

/**
 * Compile the preferences schema with the same ajv options and the same
 * wrapping conf uses internally (the flat per-key map becomes the `properties`
 * of an object schema; ajv options: allErrors + useDefaults + formats), so the
 * pre-flight verdict matches what the Store would decide on load.
 */
export const compilePreferencesValidator = (schema: object): ValidateFunction => {
  const ajv = new Ajv({ allErrors: true, useDefaults: true })
  ajvFormats(ajv)
  return ajv.compile({ type: 'object', properties: schema })
}

export function quarantineInvalidPreferencesFile(
  filePath: string,
  validate: ValidateFunction
): PreferencesFileQuarantine {
  if (!fs.existsSync(filePath)) {
    return { quarantined: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    const backupPath = `${filePath}.corrupt-${Date.now()}`
    fs.renameSync(filePath, backupPath)
    return { quarantined: true, reason: 'json-parse', backupPath }
  }

  if (!validate(parsed)) {
    const backupPath = `${filePath}.invalid-${Date.now()}`
    fs.renameSync(filePath, backupPath)
    return { quarantined: true, reason: 'schema-violation', backupPath }
  }

  return { quarantined: false }
}
