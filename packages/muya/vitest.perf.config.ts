import { defineConfig } from 'vitest/config'

// Dedicated config for the perf microbench files.
//
// The default `vite.config.ts` test block excludes the bench files — they are
// measurement, not a regression gate, and their 1MB tiers need ~8-10 minutes
// and ~2GB+ heap per worker (they OOM the ubuntu CI runner). This config
// re-includes them so `pnpm test:perf` can drive the benches on demand with a
// ceiling that fits the slowest tier.
//
// Usage: pnpm -C packages/muya test:perf
export default defineConfig({
  test: {
    environment: 'happy-dom',
    css: true,
    include: [
      'src/state/__tests__/keystrokePipeline.bench.spec.ts',
      'src/block/scrollPage/__tests__/scrollPageRender.bench.spec.ts'
    ],
    testTimeout: 600_000,
    hookTimeout: 60_000
  }
})
