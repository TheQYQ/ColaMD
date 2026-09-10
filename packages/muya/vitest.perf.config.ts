import { defineConfig } from 'vitest/config'

// Dedicated config for the M1.0 keystroke-pipeline microbench.
//
// The default `vite.config.ts` test block excludes the bench file — it is
// measurement, not a regression gate, and its 1MB tier needs ~8-10 minutes
// and ~2GB+ heap per worker (it OOMs the ubuntu CI runner). This config
// re-includes it so `pnpm test:perf` can drive the bench on demand with a
// ceiling that fits the slowest tier.
//
// Usage: pnpm -C packages/muya test:perf
export default defineConfig({
  test: {
    environment: 'happy-dom',
    css: true,
    include: ['src/state/__tests__/keystrokePipeline.bench.spec.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000
  }
})
