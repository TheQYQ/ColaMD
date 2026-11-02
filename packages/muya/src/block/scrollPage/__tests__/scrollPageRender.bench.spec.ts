// @vitest-environment happy-dom

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';
import { makeDoc } from '../../../state/__tests__/fixtures/keystrokeDocs';

// SB (PERF-04) ScrollPage render microbench. `ScrollPage.updateState` is the
// full-DOM-rebuild path behind setContent / forceRender / undo-redo boundary
// rebuilds / the updateContents error fallback: it empties the container and
// re-creates every block. The keyed-diff + viewport-virtualization work will
// turn it into O(changed blocks) + O(viewport); this file records the
// before-numbers it must beat.
//
// Same conventions as the keystroke bench: @perf-tagged, run via
// `pnpm -C packages/muya test:perf`, loose budgets that only catch
// order-of-magnitude regressions, real numbers recorded in
// docs/perf-baseline.md. Not a CI hard-assert on wall-clock.

const SIZES = [
    { label: '100KB', bytes: 100_000 },
    { label: '500KB', bytes: 500_000 },
    { label: '1MB', bytes: 1_000_000 },
] as const;

// Loose ceilings (ms) for one full `ScrollPage.updateState` — far above
// healthy local numbers, tight enough to catch a 10× regression.
const BUDGETS_MS = {
    domUpdate: { '100KB': 10_000, '500KB': 30_000, '1MB': 60_000 },
} as const;

const hosts: HTMLElement[] = [];

function boot(md: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: md } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function timeIt(fn: () => void): number {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

function report(label: string, samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor((sorted.length - 1) / 2)];
    const max = sorted[sorted.length - 1];
    // eslint-disable-next-line no-console
    console.log(
        `[scrollpage-bench] ${label}: p50=${p50.toFixed(1)}ms max=${max.toFixed(1)}ms n=${samples.length}`,
    );
    return p50;
}

describe('scrollPage render microbench @perf', () => {
    beforeAll(() => {
        window.MUYA_VERSION = 'test';
    });

    afterAll(() => {
        while (hosts.length) hosts.pop()!.remove();
    });

    for (const { label, bytes } of SIZES) {
        it(`measures ScrollPage full-rebuild + DOM scale on ~${label}`, () => {
            const md = makeDoc(bytes);
            expect(md.length).toBeGreaterThanOrEqual(bytes);

            // Initial mount (create path) — untimed; its JSONState half is
            // already recorded by the keystroke bench as setContent.
            const muya = boot(md);
            const scrollPage = muya.editor.scrollPage!;
            const blockCount = scrollPage.children.length;
            expect(blockCount).toBeGreaterThan(0);

            // DOM scale — the virtualization target metric: after SB, nodes
            // should be O(viewport) instead of O(document).
            const domNodes = scrollPage.domNode!.querySelectorAll('*').length;

            // Full rebuild. Fresh state per sample (getState deep-clones; its
            // cost is recorded separately in the keystroke bench).
            const rebuildSamples: number[] = [];
            const REBUILD_ITERS = label === '1MB' ? 2 : 3;
            for (let i = 0; i < REBUILD_ITERS; i++) {
                const state = muya.editor.jsonState.getState();
                rebuildSamples.push(timeIt(() => {
                    scrollPage.updateState(state);
                }));
            }
            const rebuildP50 = report(`updateState(${label})`, rebuildSamples);

            // The rebuild must not lose blocks.
            expect(scrollPage.children.length).toBe(blockCount);

            // eslint-disable-next-line no-console
            console.log(`[scrollpage-bench] scale(${label}): blocks=${blockCount} domNodes=${domNodes}`);

            expect(rebuildP50).toBeLessThan(BUDGETS_MS.domUpdate[label]);
        }, 600_000);
    }
});
