import { describe, expect, it } from 'vitest'
import QuickOpenCommand from '@/commands/quickOpen'

// Quick open fuzzy-matches the query against open tab paths by compiling the
// query into a RegExp (commands/quickOpen.ts). The guard added there must change
// only the COST and the failure mode, never which files come back, so the first
// spec below compares against a local copy of the pre-fix mapping. That
// duplication is the point: it is the reference the production code is measured
// against, and it encodes nothing new about how a glob is compiled.
const SPECIAL_CHARS = /[\[\]\\^$.\|\?\*\+\(\)\/]{1}/g // eslint-disable-line no-useless-escape

const toSource = (query: string): string =>
  query.replace(SPECIAL_CHARS, (p) => {
    if (p === '*') return '.*'
    return p === '\\' ? '\\\\' : `\\${p}`
  })

const referenceMatch = (query: string, pathname: string): boolean =>
  new RegExp(toSource(query), 'i').test(pathname)

const compileFails = (query: string): boolean => {
  try {
    void new RegExp(toSource(query), 'i')
    return false
  } catch {
    return true
  }
}

const searchTabs = (query: string, tabs: string[]): string[] => {
  const quickOpen = new QuickOpenCommand({
    editor: { tabs: tabs.map((pathname) => ({ pathname })) },
    project: { projectTree: null }
  } as unknown as ConstructorParameters<typeof QuickOpenCommand>[0])
  const result = quickOpen._doSearch(query)
  if (Array.isArray(result)) {
    return result.map((item) => item.id)
  }
  throw new Error('tabs-only state must search synchronously')
}

// Deliberately no path over ~70 characters: the reference mapping is the
// unguarded one, and a long path plus a multi-star query is the case it cannot
// afford to run. The cost of that case is pinned on its own below.
const PATHS = [
  'C:\\Users\\lyg\\AppData\\Local\\Temp\\colamd-e2etest-2026929-a1b2c3\\note.md',
  'C:\\Users\\lyg\\Documents\\Markdown\\2026\\季度报告\\季度报告.md',
  '/home/dev/colamd/README.md',
  '/home/dev/colamd/docs/PROJECT_GUIDE.md',
  '/tmp/a.md.md',
  '/tmp/x[1].md',
  '/tmp/weird{1,2}name.md',
  'D:\\a+b (1)\\file.pdf',
  'notes.txt'
]

describe('quick open pattern compilation', () => {
  it('returns the same files as the unguarded mapping', () => {
    const queries = [
      'note',
      'README',
      '*.md',
      '**/*.md',
      '***report',
      'a*b*c',
      'C:\\Users\\lyg',
      '季度',
      'x[1]',
      'a+b',
      '(1)',
      'docs/PROJECT',
      'a.md.md',
      'tail',
      '.md',
      '*',
      '**',
      'NOTES',
      '/home'
    ]
    let compared = 0
    for (const query of queries) {
      const expected = PATHS.filter((p) => referenceMatch(query, p))
      expect(searchTabs(query, PATHS), query).toEqual(expected)
      compared += expected.length
    }
    // Guards the spec itself: an empty corpus or a query list that matches
    // nothing would compare ten empties and still be green.
    expect(compared).toBeGreaterThan(20)
    expect(new Set(PATHS.filter((p) => referenceMatch('*.md', p))).size).toBeGreaterThan(5)
  })

  it('compiles a run of stars once instead of nesting them', () => {
    // Measured on this exact corpus: the unguarded mapping costs 1082 ms for
    // five stars and does not return at all within 8 s for six. In a real
    // window one tab cost 23.2 s (test/e2e/quick-open-pattern-safety.spec.ts).
    const started = Date.now()
    expect(searchTabs('*****zzz', PATHS)).toEqual([])
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('matches literal text when the query is not a valid pattern', () => {
    // `{` and `}` are not escaped, so a quantifier with nothing to repeat used
    // to throw inside the search and empty the result list.
    for (const query of ['{2,}', '*{2,}', 'a{2,}{2,}', '{1,2}name']) {
      expect(compileFails(query), query).toBe(true)
    }
    expect(searchTabs('{1,2}name', PATHS)).toEqual(['/tmp/weird{1,2}name.md'])
    expect(searchTabs('weird{1,2}', PATHS)).toEqual(['/tmp/weird{1,2}name.md'])
  })
})
