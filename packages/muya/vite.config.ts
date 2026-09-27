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
        // The largest JS-imported asset (an editor icon) is 5.9KB; anything
        // at or below this limit is inlined as a data URI instead of being
        // emitted as a file that the bundle imports at runtime. That matters
        // because a lib build that does `import icon from '../assets/x.png'`
        // crashes plain Node (`require`/`import` of a .png) — it only ever
        // worked when the consumer ran a bundler. Fonts stay external via
        // the lib-assets plugin below (CSS is never loaded by Node).
        assetsInlineLimit: 8 * 1024,
        lib: {
            entry: resolve(dirname, 'src/index.ts'),
            name: pkg.name,
            fileName: format => `${format}/index.js`,
            formats: ['es', 'umd', 'cjs'],
            // Default is the sanitized package name ("core"), but the README
            // and the "./*" export surface document `lib/style.css` — keep the
            // emitted stylesheet aligned with what consumers are told to import.
            cssFileName: 'style',
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
        // snabbdom 3.6.4 compiles `window?.requestAnimationFrame` into
        // `window === null || window === void 0 ? void 0 : …`, which throws
        // ReferenceError wherever `window` is undeclared — i.e. any Node
        // evaluation of the published lib (SSR via renderToStaticHTML)
        // crashes at import time, in the consumer's own node_modules where
        // no patch can reach. Rewriting the probe at build time keeps the
        // fix in this repo and CI-reproducible; semantics are unchanged
        // (browsers take the rAF branch, Node falls back to setTimeout).
        {
            name: 'snabbdom-style-raf-guard',
            transform(code, id) {
                if (!id.replace(/\\/g, '/').includes('snabbdom/build/modules/style.js')) return null
                const unsafe = 'typeof (window === null || window === void 0 ? void 0 : window.requestAnimationFrame) === "function"'
                if (!code.includes(unsafe)) return null
                return code.replace(
                    unsafe,
                    'typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"'
                )
            },
        },
        dts({
            entryRoot: 'src',
            outDirs: 'lib/types',
        }),
        libAssetsPlugin({
            // Extract only assets above the inline limit (the fonts — an
            // editor icon is at most 5.9KB, a KaTeX/mermaid font file is
            // typically 10-500KB). This keeps the bundles Node-loadable
            // while fonts stay real files referenced from core.css.
            limit: 8 * 1024,
            outputPath: (url) => {
                return url.endsWith('.png') ? 'assets/icons' : 'assets/fonts';
            },
        }),
    ],
});
