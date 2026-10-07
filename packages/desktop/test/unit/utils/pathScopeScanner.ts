import { readdirSync, readFileSync } from 'fs'
import path from 'path'

// Static scanner for the pathScope coverage inventory. Extracts four sets from
// main-process source + the IPC contract file:
//   1. typedOn/typedHandle/onInternalChannel channel registrations
//   2. assertPathInScope call sites  (file + call-text snippet, multiset)
//   3. addAllowedRoot call sites     (file + call-text snippet, multiset)
//   4. IpcSendChannels interface keys
// Channel names are literal string arguments in this codebase (enforced by the
// typedOn contract types), so regex extraction is sufficient; a computed name
// would fail the typedOn typing before it could hide from this scan.

interface ScannedRegistration {
  channel: string
  via: 'typedOn' | 'typedHandle' | 'onInternalChannel'
  file: string
  line: number
}

interface ScannedSite {
  file: string
  snippet: string
}

export interface ScanResult {
  registrations: ScannedRegistration[]
  assertSites: ScannedSite[]
  grantSites: ScannedSite[]
  sendChannels: string[]
}

const REGISTRATION_RE = /\b(typedOn|typedHandle|onInternalChannel)\(\s*['"]([^'"]+)['"]/g

// `function ` lookbehind skips definitions (`export function addAllowedRoot…`);
// comment stripping skips prose mentions. Call text is captured with balanced
// parens so nested calls like addAllowedRoot(path.dirname(x)) stay intact.
const CALL_RE = /(?<!function\s)\b(assertPathInScope|addAllowedRoot)\s*\(/g

const EMPTY: ScanResult = {
  registrations: [],
  assertSites: [],
  grantSites: [],
  sendChannels: []
}

// Drop // line comments and /* */ block comments so prose mentioning a call
// name does not register as a call site.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))

// Collapse whitespace outside string literals so `assertPathInScope( p )` and
// `assertPathInScope(p)` normalize to the same ledger key.
const normalizeCallText = (raw: string): string => {
  let out = ''
  let quote: string | null = null
  for (const ch of raw) {
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (/\s/.test(ch)) continue
    out += ch
  }
  return out
}

// From the identifier start of a call, walk past '(' to the matching ')'
// (string-literal aware) and return the normalized full call text.
const readBalancedCall = (src: string, identStart: number, openIndex: number): string | null => {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === quote && src[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return normalizeCallText(src.slice(identStart, i + 1))
    }
  }
  return null
}

const lineOfIndex = (src: string, index: number): number => {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++
  }
  return line
}

const collectCallSites = (
  file: string,
  src: string,
  name: 'assertPathInScope' | 'addAllowedRoot'
): ScannedSite[] => {
  const stripped = stripComments(src)
  const sites: ScannedSite[] = []
  const re = new RegExp(CALL_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(stripped)) !== null) {
    if (match[1] !== name) continue
    const openIndex = match.index + match[0].length - 1
    const callText = readBalancedCall(stripped, match.index, openIndex)
    if (callText) sites.push({ file, snippet: callText })
  }
  return sites
}

const collectRegistrations = (file: string, src: string): ScannedRegistration[] => {
  const out: ScannedRegistration[] = []
  const re = new RegExp(REGISTRATION_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(src)) !== null) {
    out.push({
      channel: match[2],
      via: match[1] as ScannedRegistration['via'],
      file,
      line: lineOfIndex(src, match.index)
    })
  }
  return out
}

const collectSendChannels = (src: string): string[] => {
  const start = src.indexOf('interface IpcSendChannels')
  if (start === -1) return []
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) return []
  let depth = 0
  let end = -1
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return []
  const body = src.slice(braceStart + 1, end)
  const keys: string[] = []
  const keyRe = /['"]([^'"]+)['"]\s*:/g
  let match: RegExpExecArray | null
  while ((match = keyRe.exec(body)) !== null) keys.push(match[1])
  return keys
}

/** Pure scan over in-memory files. Keys are file paths; values are contents. */
export function scanText(files: Record<string, string>): ScanResult {
  const sortedKeys = Object.keys(files).sort()
  const result: ScanResult = {
    registrations: [],
    assertSites: [],
    grantSites: [],
    sendChannels: []
  }
  for (const file of sortedKeys) {
    const src = files[file]
    result.registrations.push(...collectRegistrations(file, src))
    result.assertSites.push(...collectCallSites(file, src, 'assertPathInScope'))
    result.grantSites.push(...collectCallSites(file, src, 'addAllowedRoot'))
    if (file.endsWith('shared/types/ipc.ts')) {
      result.sendChannels = collectSendChannels(src)
    }
  }
  return result
}

const listTsFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listTsFiles(full, acc)
    else if (entry.isFile() && entry.name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

/**
 * Scan the real tree: every TypeScript file under src/main plus the IPC
 * contract file. Returned `file` keys are posix-style paths relative to
 * `packageRoot`.
 */
export function scanSource(packageRoot: string): ScanResult {
  const mainRoot = path.join(packageRoot, 'src', 'main')
  const ipcTypes = path.join(packageRoot, 'src', 'shared', 'types', 'ipc.ts')
  const files: Record<string, string> = {}
  for (const full of listTsFiles(mainRoot)) {
    const rel = path.relative(packageRoot, full).split(path.sep).join('/')
    files[rel] = readFileSync(full, 'utf8')
  }
  files[path.relative(packageRoot, ipcTypes).split(path.sep).join('/')] = readFileSync(
    ipcTypes,
    'utf8'
  )
  return scanText(files)
}

export { EMPTY as emptyScanResult }
