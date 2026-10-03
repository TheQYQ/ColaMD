import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Integration through the real spawn instead of a child_process mock: vitest 4
// did not apply the builtin mock to the source module's own import, but the
// COLAMD_PANDOC seam lets the converter run against a guaranteed-present
// command. `node` rejects the converter's fixed `-s` argument with exit code 9
// and a stderr message — the exact shape the old code papered over by
// resolving on stdout end (it would have handed back '' as a success).

const previousEnv = process.env.COLAMD_PANDOC

beforeAll(() => {
  process.env.COLAMD_PANDOC = process.execPath
})

afterAll(() => {
  if (previousEnv === undefined) delete process.env.COLAMD_PANDOC
  else process.env.COLAMD_PANDOC = previousEnv
})

describe('pandoc converter exit-code check', () => {
  it('rejects on a non-zero exit instead of resolving partial output as success', async () => {
    const { default: pandoc } = await import('main_renderer/utils/pandoc')
    await expect(pandoc('in.md', 'html')()).rejects.toThrow(/bad option/)
  })
})
