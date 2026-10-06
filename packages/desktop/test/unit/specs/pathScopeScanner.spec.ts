import { describe, expect, it } from 'vitest'

import { scanText } from '../utils/pathScopeScanner'

// Fixture files are hand-authored; every expectation below is derived by hand
// from the fixture text, never computed by the scanner.
const FIXTURE: Record<string, string> = {
  'main/ipc/fs.ts': [
    "import { assertPathInScope } from '../security/pathScope'",
    '',
    'export function registerFs(): void {',
    "  typedHandle('mt::fs::read-file', async (_e, p: string) => {",
    '    await assertPathInScope(p)',
    '    return read(p)',
    '  })',
    "  typedHandle('mt::fs::write-file', async (_e, p: string) => {",
    '      await  assertPathInScope( p )',
    '    await write(p)',
    '  })',
    '}'
  ].join('\n'),
  'main/security/pathScope.ts': [
    'export function addAllowedRoot(dir: string): void {',
    '  // prose mentioning addAllowedRoot( must not count as a call site',
    '}',
    '',
    'export async function assertPathInScope(candidate: string): Promise<string> {',
    '  return candidate',
    '}'
  ].join('\n'),
  'main/app/index.ts': [
    "onInternalChannel('broadcast-user-data-changed', (userData) => {",
    '  if (userData) addAllowedRoot(userData.folder)',
    '})',
    '',
    "typedOn('app-open-file-by-id', (windowId, filePath) => {",
    '  addAllowedRoot(path.dirname(filePath))',
    '  addAllowedRoot(filePath)',
    '})'
  ].join('\n'),
  'shared/types/ipc.ts': [
    'export interface IpcSendChannels {',
    "  'mt::fs::read-file': [p: string]",
    "  'app-open-file-by-id': [windowId: number, filePath: string]",
    '}'
  ].join('\n')
}

describe('pathScopeScanner.scanText', () => {
  it('collects typedOn/typedHandle/onInternalChannel registrations with file and line', () => {
    const { registrations } = scanText(FIXTURE)

    // Files are iterated in sorted key order; within a file, line order.
    expect(registrations).toEqual([
      {
        channel: 'broadcast-user-data-changed',
        via: 'onInternalChannel',
        file: 'main/app/index.ts',
        line: 1
      },
      {
        channel: 'app-open-file-by-id',
        via: 'typedOn',
        file: 'main/app/index.ts',
        line: 5
      },
      {
        channel: 'mt::fs::read-file',
        via: 'typedHandle',
        file: 'main/ipc/fs.ts',
        line: 4
      },
      {
        channel: 'mt::fs::write-file',
        via: 'typedHandle',
        file: 'main/ipc/fs.ts',
        line: 8
      }
    ])
  })

  it('collects assertPathInScope call sites as file+snippet multisets and skips the definition', () => {
    const { assertSites } = scanText(FIXTURE)

    expect(assertSites).toEqual([
      { file: 'main/ipc/fs.ts', snippet: 'assertPathInScope(p)' },
      { file: 'main/ipc/fs.ts', snippet: 'assertPathInScope(p)' }
    ])
  })

  it('collects addAllowedRoot call sites with balanced-paren snippets and skips the definition', () => {
    const { grantSites } = scanText(FIXTURE)

    expect(grantSites).toEqual([
      { file: 'main/app/index.ts', snippet: 'addAllowedRoot(userData.folder)' },
      { file: 'main/app/index.ts', snippet: 'addAllowedRoot(path.dirname(filePath))' },
      { file: 'main/app/index.ts', snippet: 'addAllowedRoot(filePath)' }
    ])
  })

  it('extracts IpcSendChannels keys from the interface body', () => {
    const { sendChannels } = scanText(FIXTURE)

    expect(sendChannels).toEqual(['mt::fs::read-file', 'app-open-file-by-id'])
  })
})
