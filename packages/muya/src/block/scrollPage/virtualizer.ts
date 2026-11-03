// SB (PERF-04) viewport virtualization for ScrollPage.
//
// The block TREE stays complete (queryBlock / selection paths / undo all keep
// their semantics); only DOM attachment is windowed. A sweep reconciles the
// container's child slots against the desired window: blocks inside the
// visible band keep their real DOM, blocks outside it are detached and
// replaced by a placeholder preserving the EXACT space the block occupied —
// including its share of the collapsed vertical margins between adjacent
// siblings (see measureFreedSpace; naive offsetHeight placeholders drifted
// the document by hundreds of pixels mid-scroll).
//
// Placeholders are derived state — every sweep rebuilds the registry and
// removes orphans — so block-tree mutations between sweeps never need
// placeholder bookkeeping.
//
// Degradation: with no real layout (happy-dom / unit tests) every measured
// height is 0, nothing is ever detached, and the sweep is a no-op — tests
// and benches keep the exact pre-virtualization behavior.

export interface IVirtualWindow {
    start: number;
    end: number;
}

/**
 * Compute the [start, end) index window of blocks intersecting the visible
 * band [scrollTop - margin, scrollTop + viewportHeight + margin), given the
 * per-block occupied heights. Pure so the decision logic is unit-testable
 * without a layout engine.
 */
export function computeWindow(
    heights: number[],
    scrollTop: number,
    viewportHeight: number,
    margin: number,
): IVirtualWindow {
    if (heights.length === 0)
        return { start: 0, end: 0 };

    let offset = 0;
    let start = -1;
    let end = -1;

    for (let i = 0; i < heights.length; i++) {
        const top = offset;
        const bottom = offset + heights[i];
        offset = bottom;

        if (bottom > scrollTop - margin && top < scrollTop + viewportHeight + margin) {
            if (start === -1)
                start = i;
            end = i + 1;
        }
    }

    // At least one block must always stay mounted: an empty window would
    // collapse the document height and strand the scroll position.
    if (start === -1)
        return { start: heights.length - 1, end: heights.length };

    return { start, end };
}

const SWEEP_THROTTLE_MS = 66;
const WINDOW_MARGIN_PX = 2000;

function verticalMargins(el: HTMLElement): { top: number; bottom: number } {
    const style = window.getComputedStyle(el);
    return {
        top: Number.parseFloat(style.marginTop || '0'),
        bottom: Number.parseFloat(style.marginBottom || '0'),
    };
}

/**
 * The space that detaching `domNode` frees from the container: its height
 * plus the collapsed vertical margins it partakes in, exactly as CSS
 * sibling-margin collapsing settles them. Negative margins are not modeled
 * (muya uses none); with positive margins this is algebraically exact:
 *
 *   before = max(mbPrev, mtMe) + height + max(mbMe, mtNext)
 *   after  = prev && next ? max(mbPrev, mtNext) : (prev ? mbPrev : mtNext)
 *   freed  = before - after
 *
 * (A missing neighbor means the container edge — muya's container has
 * padding, so edge margins do not collapse through it.)
 */
function measureFreedSpace(domNode: HTMLElement): number {
    const own = verticalMargins(domNode);
    const height = domNode.offsetHeight;
    const prev = domNode.previousElementSibling as HTMLElement | null;
    const next = domNode.nextElementSibling as HTMLElement | null;
    const mbPrev = prev ? verticalMargins(prev).bottom : 0;
    const mtNext = next ? verticalMargins(next).top : 0;

    const before = Math.max(mbPrev, own.top) + height + Math.max(own.bottom, mtNext);
    const after
        = prev && next
            ? Math.max(mbPrev, mtNext)
            : prev
                ? mbPrev
                : next
                    ? mtNext
                    : 0;

    return before - after;
}

export class ScrollPageVirtualizer {
    /** block -> placeholder element currently occupying its container slot. */
    private _placeholders = new Map<object, HTMLElement>();

    /** Last measured occupied heights (only for blocks that were mounted). */
    private _measured = new WeakMap<object, number>();

    /**
     * Blocks mounted on demand (queryBlock / caret paths) — the sweep must
     * not detach them until the next real user scroll.
     */
    private _pinned = new WeakSet<object>();

    private _lastSweep = 0;
    private _suppressedUntil = 0;
    private _scrollListener: (() => void) | null = null;
    private _resizeListener: (() => void) | null = null;

    constructor(
        private _getContainer: () => HTMLElement | null,
        private _getChildren: () => object[],
        private _getDomNode: (block: object) => HTMLElement | null,
        private _remount: (block: object) => void,
    ) {}

    public get active(): boolean {
        return this._scrollListener !== null;
    }

    /**
     * Start listening. Scroll does not bubble, but it DOES propagate through
     * the capture phase, so a capture listener on window sees scrolls of any
     * ancestor scroller without knowing which one it is.
     */
    public attach(): void {
        if (this.active)
            return;

        this._scrollListener = (): void => {
            // Any real user scroll invalidates the on-demand pins: the caret
            // block is either in view (it caused the scroll) or the user
            // moved away from it.
            this._pinned = new WeakSet();
            this.requestSweep();
        };
        this._resizeListener = (): void => this.requestSweep();
        window.addEventListener('scroll', this._scrollListener, true);
        window.addEventListener('resize', this._resizeListener);
    }

    public detach(): void {
        if (this._scrollListener) {
            window.removeEventListener('scroll', this._scrollListener, true);
            this._scrollListener = null;
        }
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
            this._resizeListener = null;
        }
        this.restoreAll();
    }

    public isDetached(block: object): boolean {
        return this._placeholders.has(block);
    }

    /**
     * Drop the placeholder of a block that leaves the tree. Safe to call for
     * mounted / unknown blocks.
     */
    public release(block: object): void {
        const placeholder = this._placeholders.get(block);
        if (placeholder) {
            placeholder.remove();
            this._placeholders.delete(block);
        }
    }

    /**
     * Mount a single block on demand (selection restore, caret jumps into
     * off-screen territory). Re-renders its inline content so render inputs
     * that changed while it was detached (search highlights, reference
     * labels) apply. Pinned: the sweep will not detach it until the next
     * user scroll.
     */
    public mount(block: object): void {
        const placeholder = this._placeholders.get(block);
        if (!placeholder)
            return;

        const domNode = this._getDomNode(block);
        if (!domNode)
            return;

        placeholder.replaceWith(domNode);
        this._placeholders.delete(block);
        this._pinned.add(block);
        this._remount(block);
    }

    /**
     * Skip sweeps until `ms` from now. Programmatic scroll animations own
     * the scroll position while they run - a sweep detaching/remounting
     * blocks mid-flight competes with the animation (measured: an upward TOC
     * jump stalled at 2806 of its 338 target). The caller sweeps once after
     * the animation settles.
     */
    public suppressSweeps(ms: number): void {
        this._suppressedUntil = performance.now() + ms;
    }

    public requestSweep(immediate = false): void {
        const now = performance.now();
        if (now < this._suppressedUntil)
            return;
        if (!immediate && now - this._lastSweep < SWEEP_THROTTLE_MS)
            return;
        this._lastSweep = now;

        const container = this._getContainer();
        const children = this._getChildren();
        if (!container || children.length === 0)
            return;

        const { start, end } = this._visibleWindow(children, container);
        this._reconcileSlots(children, container, start, end);
        this._cleanupOrphans(container);
    }

    /**
     * The visible band in container coordinates: the container's live
     * viewport rect already accounts for every scrolling ancestor.
     */
    private _visibleWindow(children: object[], container: HTMLElement): IVirtualWindow {
        const heights = children.map((block) => {
            const placeholder = this._placeholders.get(block);
            if (placeholder)
                return this._measured.get(block) ?? 0;
            return this._getDomNode(block)?.offsetHeight ?? 0;
        });
        const bandStart = Math.max(0, -container.getBoundingClientRect().top);
        const viewHeight = window.innerHeight || 0;
        return computeWindow(heights, bandStart, viewHeight, WINDOW_MARGIN_PX);
    }

    /**
     * Two passes — all measurements, then all writes — so a sweep never
     * interleaves layout reads with DOM writes.
     */
    private _reconcileSlots(
        children: object[],
        container: HTMLElement,
        start: number,
        end: number,
    ): void {
        const remount: object[] = [];
        const detach: { block: object; height: number }[] = [];
        for (let i = 0; i < children.length; i++) {
            const block = children[i];
            const inWindow = i >= start && i < end;
            if (inWindow) {
                if (this._placeholders.has(block))
                    remount.push(block);
            }
            else if (!this._placeholders.has(block) && !this._pinned.has(block)) {
                // Only detach with a MEASURED height: swapping real pixels
                // for an estimate would shift everything below the slot.
                const domNode = this._getDomNode(block);
                const height = domNode ? measureFreedSpace(domNode) : 0;
                if (height > 0)
                    detach.push({ block, height });
            }
        }

        for (const block of remount) {
            const placeholder = this._placeholders.get(block);
            const domNode = this._getDomNode(block);
            if (!placeholder || !domNode)
                continue;
            placeholder.replaceWith(domNode);
            this._placeholders.delete(block);
            this._remount(block);
        }
        for (const { block, height } of detach) {
            const domNode = this._getDomNode(block);
            if (!domNode || domNode.parentElement !== container)
                continue;
            const placeholder = document.createElement('div');
            placeholder.className = 'mu-virtual-placeholder';
            placeholder.style.height = `${height}px`;
            domNode.replaceWith(placeholder);
            this._placeholders.set(block, placeholder);
            this._measured.set(block, height);
        }
    }

    /**
     * Placeholders of blocks that left the tree between sweeps: harmless
     * layout until here, then removed.
     */
    private _cleanupOrphans(container: HTMLElement): void {
        const tracked = new Set(this._placeholders.values());
        for (const child of [...container.children]) {
            if (child instanceof HTMLElement
                && child.classList.contains('mu-virtual-placeholder')
                && !tracked.has(child)) {
                child.remove();
            }
        }
    }

    /** Detach every placeholder and put the real DOM back — teardown. */
    public restoreAll(): void {
        for (const [block, placeholder] of [...this._placeholders]) {
            const domNode = this._getDomNode(block);
            if (domNode)
                placeholder.replaceWith(domNode);
            this._placeholders.delete(block);
        }
    }
}
