import { describe, expect, it } from 'vitest';
import { computeWindow } from '../virtualizer';

// Pure decision logic for the ScrollPage virtualizer's visible band — no
// layout engine needed. The real-browser behavior is pinned by the muya e2e
// stability/perf.spec.ts (10k-paragraph mounted-fraction + reachability).

describe('computeWindow', () => {
    it('returns an empty window for an empty document', () => {
        expect(computeWindow([], 0, 800, 2000)).toEqual({ start: 0, end: 0 });
    });

    it('selects the blocks intersecting the visible band plus margin', () => {
        // 10 blocks of 100px each; viewport 300px tall at scrollTop 400,
        // margin 0 → band [400, 700] → blocks 4..6 (tops 400/500/600).
        const heights: number[] = Array.from<number>({ length: 10 }).fill(100);
        expect(computeWindow(heights, 400, 300, 0)).toEqual({ start: 4, end: 7 });
    });

    it('expands the window by the margin on both sides', () => {
        const heights: number[] = Array.from<number>({ length: 10 }).fill(100);
        // band [400-150, 700+150] = [250, 850] → blocks 2..8.
        expect(computeWindow(heights, 400, 300, 150)).toEqual({ start: 2, end: 9 });
    });

    it('keeps zero-height blocks inside any band (happy-dom no-op contract)', () => {
        // With no real layout every height is 0: every top/bottom is 0, which
        // satisfies both band conditions for any scrollTop ≤ margin — the
        // sweep must become a no-op instead of detaching the whole document.
        const heights: number[] = Array.from<number>({ length: 50 }).fill(0);
        const win = computeWindow(heights, 0, 800, 2000);
        expect(win).toEqual({ start: 0, end: 50 });
    });

    it('never returns an empty window: past-the-end bands fall back to the last block', () => {
        // An empty window would collapse the document height and strand the
        // scroll position — at least one block must always stay mounted.
        const heights: number[] = Array.from<number>({ length: 5 }).fill(100);
        expect(computeWindow(heights, 900, 300, 0)).toEqual({ start: 4, end: 5 });
    });
});
