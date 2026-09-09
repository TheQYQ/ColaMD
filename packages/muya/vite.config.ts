import { resolve } from 'node:path';
import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vitest/config';

import pkg from './package.json';

// eslint-disable-next-line node/prefer-global/process
const dirname = process.cwd();

export default defineConfig({
    build: {
        target: 'chrome70',
        outDir: 'lib',
        lib: {
            entry: resolve(dirname, 'src/index.ts'),
            name: pkg.name,
            fileName: format => `${format}/index.js`,
            formats: ['es', 'umd', 'cjs'],
        },
    },
    test: {
        // Process CSS imports (including `?inline`) so the export path's
        // inlined base stylesheets resolve to real content under Vitest.
        // Without this Vitest defaults to `css: { include: [] }` and every
        // CSS import returns an empty string, which would silently mask the
        // PG7 offline-export regression in `parityExportHtml.spec.ts`.
        css: true,
        coverage: {
            include: ['src/**/*.ts'],
            reporter: ['html', 'text', 'json'],
            provider: 'istanbul',
        },
        // Default `vitest run` only picks up co-located unit tests under
        // `src/**/__tests__/`. The CommonMark / GFM spec conformance suites
        // live under `test/spec/` and are run via the `test:spec` scripts,
        // which use a dedicated `--config vitest.spec.config.ts` whose
        // `test.include` glob targets `test/spec/**/*.{spec,test}.ts`.
        // Keeping spec tests out of the default `pnpm test` keeps the
        // inner-loop fast and reports compliance pass-rate as its own
        // surface.
        include: ['src/**/__tests__/**/*.{spec,test}.ts'],
        // The M1.0 keystroke microbench is measurement, not a regression gate:
        // keep it out of the default run (1MB tier: ~8-10min, ~2GB+ heap).
        // Run it via pnpm -C packages/muya test:perf.
        exclude: ['src/state/__tests__/keystrokePipeline.bench.spec.ts'],
        // The M1.0 keystroke-pipeline microbench (keystrokePipeline.bench.spec.ts)
        // runs 100KB/500KB/1MB tiers; the 1MB tier alone takes ~8-10 minutes in
        // happy-dom. The spec declares its own 600s per-case timeout, but vitest
        // requires the global hookTimeout/testTimeout floor to not clamp it in
        // plain `vitest run` (CI has no extra CLI flags).
        testTimeout: 600_000,
        hookTimeout: 60_000,
    },
    plugins: [
        dts({
            entryRoot: 'src',
            outDirs: 'lib/types',
        }),
        libAssetsPlugin({
            outputPath: (url) => {
                return url.endsWith('.png') ? 'assets/icons' : 'assets/fonts';
            },
        }),
    ],
});
