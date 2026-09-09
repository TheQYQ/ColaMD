// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { getTOC } from '../getTOC';
import JSONState from '../index';
import { makeDoc } from './fixtures/keystrokeDocs';

// M1.0 keystroke-pipeline microbench. Not a CI hard-assert on wall-clock —
// budgets are deliberately loose so only order-of-magnitude regressions fail.
// Record real numbers in docs/perf-baseline.md when re-running locally.
//
// Tagged @perf so a future lane can `--grep-invert "@perf"` on PR CI.

const SIZES = [
    { label: '100KB', bytes: 100_000 },
    { label: '500KB', bytes: 500_000 },
    { label: '1MB', bytes: 1_000_000 },
] as const;

// Loose ceilings (ms) — far above healthy local numbers, tight enough to
// catch a 10× regression (e.g. accidental extra full-doc structuredClone).
const BUDGETS_MS = {
    setContent: { '100KB': 5_000, '500KB': 15_000, '1MB': 30_000 },
    getState: { '100KB': 500, '500KB': 2_000, '1MB': 4_000 },
    getMarkdown: { '100KB': 1_000, '500KB': 4_000, '1MB': 8_000 },
    getTOC: { '100KB': 500, '500KB': 2_000, '1MB': 4_000 },
    editFlush: { '100KB': 200, '500KB': 1_000, '1MB': 2_000 },
} as const;

const hosts: HTMLElement[] = [];

function makeState(md: string): JSONState {
    const muya = {
        options: {
            footnote: false,
            isGitlabCompatibilityEnabled: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
            frontMatter: false,
            math: false,
            listIndentation: 1,
        },
        eventCenter: { emit: () => {} },
    } as unknown as Muya;
    return new JSONState(muya, md);
}

function boot(md: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: md } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0)
        return Number.NaN;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

function summarize(samples: number[]): { p50: number; p95: number; max: number } {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? Number.NaN,
    };
}

function timeIt(fn: () => void): number {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

function report(label: string, samples: number[]): { p50: number; p95: number; max: number } {
    const stats = summarize(samples);
    // eslint-disable-next-line no-console
    console.log(
        `[keystroke-bench] ${label}: p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms n=${samples.length}`,
    );
    return stats;
}

describe('keystroke pipeline microbench @perf', () => {
    beforeAll(() => {
        window.MUYA_VERSION = 'test';
    });

    afterAll(() => {
        while (hosts.length) hosts.pop()!.remove();
    });

    for (const { label, bytes } of SIZES) {
        it(`measures setContent / getState / getMarkdown / getTOC / edit+flush on ~${label}`, () => {
            const md = makeDoc(bytes);
            expect(md.length).toBeGreaterThanOrEqual(bytes);

            // --- setContent (JSONState parse only; no DOM) ---
            const setSamples: number[] = [];
            let state!: JSONState;
            setSamples.push(
                timeIt(() => {
                    state = makeState(md);
                }),
            );
            // One extra rebuild for warm JIT, then measure again.
            setSamples.push(
                timeIt(() => {
                    state.setContent(md);
                }),
            );
            const setContentStats = report(`setContent(${label})`, setSamples);

            // --- getState / getMarkdown / getTOC ---
            const stateSamples: number[] = [];
            const mdSamples: number[] = [];
            const tocSamples: number[] = [];
            const ITER = 20;
            for (let i = 0; i < ITER; i++) {
                stateSamples.push(
                    timeIt(() => {
                        state.getState();
                    }),
                );
                mdSamples.push(
                    timeIt(() => {
                        state.getMarkdown();
                    }),
                );
            }
            const getStateStats = report(`getState(${label})`, stateSamples);
            const getMarkdownStats = report(`getMarkdown(${label})`, mdSamples);

            // getTOC walks the live block tree — needs a real Muya instance.
            const muya = boot(md);
            for (let i = 0; i < 10; i++) {
                tocSamples.push(
                    timeIt(() => {
                        muya.getTOC();
                    }),
                );
            }
            // getTOC via free function (same path Muya#getTOC uses).
            tocSamples.push(
                timeIt(() => {
                    getTOC(muya);
                }),
            );
            const getTOCStats = report(`getTOC(${label})`, tocSamples);
            expect(getTOC(muya).length).toBeGreaterThan(0);

            // --- one-character edit + flush (hot keystroke shape) ---
            const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
            const base = leaf.text;
            const editSamples: number[] = [];
            const EDIT_ITERS = 10;
            for (let i = 0; i < EDIT_ITERS; i++) {
                const next = `${base}${i}`;
                editSamples.push(
                    timeIt(() => {
                        leaf.text = next;
                        muya.flush();
                    }),
                );
            }
            const editFlushStats = report(`edit+flush(${label})`, editSamples);
            expect(leaf.text).not.toBe(base);

            // --- budget gates (loose; catch 10× regressions only) ---
            expect(setContentStats.p95).toBeLessThan(BUDGETS_MS.setContent[label]);
            expect(getStateStats.p95).toBeLessThan(BUDGETS_MS.getState[label]);
            expect(getMarkdownStats.p95).toBeLessThan(BUDGETS_MS.getMarkdown[label]);
            expect(getTOCStats.p95).toBeLessThan(BUDGETS_MS.getTOC[label]);
            expect(editFlushStats.p95).toBeLessThan(BUDGETS_MS.editFlush[label]);
        }, // Whole-case ceiling: well above the sum of loose budgets so a
        // single hung path surfaces as the budget assert, not a Playwright
        // / vitest timeout with a useless stack.
        600_000);
    }
});
