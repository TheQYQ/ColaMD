import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

/**
 * Perf smoke: not a benchmark, just a regression guard. The 10k-paragraph
 * setContent benchmark is intentionally large enough that any quadratic
 * regression on the render path lights up loudly; the wall-clock budgets
 * are generous so CI variance doesn't cause flakes.
 *
 * Observed numbers (local Chromium against the Vite dev server, M-class
 * macOS) at PR-4 baseline:
 *   - setContent(10000 paragraphs): ~20s wall clock. Yes, slow — muya
 *     re-renders synchronously per block via snabbdom and the Vite dev
 *     server adds unbundled-module overhead. Bundled production builds
 *     are materially faster, but we test against the dev server here.
 *   - scrollIntoView + last paragraph visible: well under 1s.
 *
 * Three timeouts are at play here — they intentionally differ; don't try
 * to "consolidate" them:
 *   - playwright.config `timeout: 30_000` — the default for every other
 *     spec. setContent(10k) alone routinely takes 15-25s on the Vite dev
 *     server, so the suite default is too tight for this spec.
 *   - `test.setTimeout(120_000)` below — the ceiling for the whole test
 *     body (setContent + scroll + assertions). Wide enough to ride out
 *     CI variance and still surface a runaway regression as a timeout.
 *   - `expect(result.ms).toBeLessThan(60_000)` further down — the actual
 *     setContent perf budget. This is the assertion that catches a 5-10×
 *     regression on the render path. A future Phase-5 nightly job can
 *     tighten this against a production bundle.
 *
 * Tagged @perf so a future Phase-2 CI config can `--grep-invert "@perf"`
 * for the PR-time runs and keep this in a nightly schedule.
 */
test.describe('stability / perf smoke @perf', () => {
    // Per-spec ceiling: 4× the assertion budget below, so an actual
    // regression surfaces via the expect (with a useful message), not a
    // Playwright timeout (with a stack trace).
    test.setTimeout(120_000);

    test('setContent with 10k paragraphs finishes within the budget and scroll is reachable', async ({ page }) => {
        // 10k short paragraphs joined with the blank-line separator marked
        // requires for distinct paragraph nodes. Building the string from
        // inside page.evaluate avoids transferring a multi-MB payload
        // across the Playwright IPC channel for every retry.
        const result = await page.evaluate(() => {
            const N = 10_000;
            const lines: string[] = [];
            for (let i = 0; i < N; i++)
                lines.push(`paragraph ${i}`);
            const md = lines.join('\n\n');

            const t0 = performance.now();
            window.muya!.setContent(md);
            const t1 = performance.now();

            return { ms: t1 - t0, n: N };
        });

        // Wide budget — see file header. Tighten once we have a baseline.
        expect(result.ms, `setContent(${result.n} paragraphs) took ${result.ms.toFixed(0)}ms`).toBeLessThan(60_000);

        // SB (PERF-04) viewport virtualization: the block TREE holds all 10k
        // blocks, but the DOM only mounts the visible band - assert the tree
        // count via the public API instead of counting rendered paragraphs.
        const blockCount = await page.evaluate(() => {
            let count = 0
            window.muya!.editor.scrollPage!.children.forEach(() => count++)
            return count
        })
        expect(blockCount).toBe(result.n)

        // The rendered DOM stays at viewport scale: a mounted fraction, the
        // rest exact-height placeholders.
        const scale = await page.evaluate(() => ({
            mounted: document.querySelectorAll('.mu-container > *:not(.mu-virtual-placeholder)').length,
            placeholders: document.querySelectorAll('.mu-virtual-placeholder').length,
        }))
        expect(scale.mounted).toBeLessThan(300)
        expect(scale.placeholders).toBeGreaterThan(9_000)

        // Scroll the last paragraph into view and assert it becomes visible
        // within 5s - materialization must keep the document reachable.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await expect(page.locator('.mu-container > *:not(.mu-virtual-placeholder)').last())
            .toContainText(`paragraph ${result.n - 1}`, { timeout: 5_000 })
    });
});
