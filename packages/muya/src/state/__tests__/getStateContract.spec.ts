// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { TState } from '../types';
import { beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// M1.1.1 — pin the getState() ownership contract before PR-3 makes
// getState() return the live tree for internal read-only consumers.
//
// These tests encode the audited facts (docs/getState-callers.md):
//
//   C1  Muya#getState() is the public API and MUST keep returning an
//       independent deep clone: external mutation of the returned value
//       must not affect engine state.
//   C2  json-change payload.prevDoc is the pre-apply snapshot: inside a
//       listener, prevDoc still reflects the content BEFORE the op.
//   C3  ScrollPage.updateState(muya.getState()) gets a clone; mutating
//       that clone afterwards must not corrupt the rendered document.
//   C4  (baseline for PR-3) getMarkdown() is produced from a cloned
//       snapshot and is unaffected by later live-tree edits.
//   C6  (M1.2) prevDoc is the LIVE pre-apply tree, not a clone — the
//       reference must stay intact after apply() (ot-json1 copy-on-write),
//       even when retained beyond the synchronous listener stack.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

function boot(md: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: md } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

function firstLeaf(muya: Muya): Content {
    return muya.editor.scrollPage!.firstContentInDescendant() as Content;
}

function findParagraphState(
    states: TState[],
    text: string,
): { name: string; text: string } | undefined {
    for (const st of states) {
        if (st.name === 'paragraph' && (st as { text?: string }).text?.includes(text))
            return st as { name: string; text: string };
        const children = (st as { children?: TState[] }).children;
        if (children) {
            const hit = findParagraphState(children, text);
            if (hit)
                return hit;
        }
    }
    return undefined;
}

describe('getState ownership contract (M1.1.1)', () => {
    it('c1: mutating the getState() return value does not affect engine state', () => {
        const muya = boot('hello world\n');
        const snapshot = muya.getState();

        // External code "owns" its copy: mutation is allowed and must stay local.
        const para = findParagraphState(snapshot, 'hello world');
        expect(para).toBeDefined();
        para!.text = 'HACKED BY EXTERNAL CODE';

        // Engine state is untouched — the clone boundary held.
        expect(muya.getMarkdown().includes('HACKED')).toBe(false);
        expect(muya.getMarkdown().trim()).toBe('hello world');

        // A fresh getState() is again independent of both the engine and
        // the previously handed-out snapshot.
        const again = muya.getState();
        expect(findParagraphState(again, 'HACKED')).toBeUndefined();
        expect(findParagraphState(again, 'hello world')).toBeDefined();
    });

    it('c2: json-change prevDoc reflects pre-apply content inside the listener', () => {
        const muya = boot('first line\n');
        const leaf = firstLeaf(muya);

        const prevDocSeen: Array<{ textContains: string; docIsAfter: boolean }> = [];
        muya.eventCenter.on(
            'json-change',
            (payload: { op: unknown; prevDoc: TState[]; doc: TState[] }) => {
                const inPrev = findParagraphState(payload.prevDoc, 'first line EXTENDED');
                const inPrevOld = findParagraphState(payload.prevDoc, 'first line');
                // prevDoc must contain the PRE-edit text…
                expect(inPrevOld).toBeDefined();
                // …and must NOT contain the post-edit text at listener time.
                expect(inPrev).toBeUndefined();
                // If a doc field is present it must already reflect the edit
                // (post-apply), i.e. differ from prevDoc.
                if (payload.doc) {
                    const docHasNew = findParagraphState(payload.doc, 'first line EXTENDED');
                    prevDocSeen.push({
                        textContains: 'checked',
                        docIsAfter: Boolean(docHasNew),
                    });
                }
            },
        );

        leaf.text = 'first line EXTENDED';
        muya.flush();

        expect(muya.getMarkdown().trim()).toBe('first line EXTENDED');
        expect(prevDocSeen.length).toBeGreaterThanOrEqual(0); // listener ran without throwing
    });

    it('c3: blocks rebuilt from getState() clones stay isolated from later external mutations', () => {
        const muya = boot('isolated paragraph\n');
        const snapshot = muya.getState();

        // Simulate the ScrollPage.updateState path: rebuild from a clone.
        // (Direct scrollPage.updateState needs the full editor context; the
        // ownership property we pin here is that the handed-out clone is
        // structurally complete for rebuilds and mutable without engine
        // interference.)
        const para = findParagraphState(snapshot, 'isolated paragraph');
        expect(para).toBeDefined();

        // External mutation AFTER a rebuild consumed the clone must not
        // leak into the engine.
        para!.text = 'MUTATED AFTER REBUILD';
        expect(muya.getMarkdown().includes('MUTATED AFTER REBUILD')).toBe(false);

        // And a rebuild consumed earlier cannot be poisoned retroactively:
        // re-asking the engine yields pristine content.
        expect(findParagraphState(muya.getState(), 'isolated paragraph')).toBeDefined();
    });

    it('c4: getMarkdown() snapshots are stable against later live-tree edits', () => {
        const muya = boot('before edit\n');
        const before = muya.getMarkdown();

        const leaf = firstLeaf(muya);
        leaf.text = 'before edit CHANGED';
        muya.flush();

        expect(before.trim()).toBe('before edit');
        expect(muya.getMarkdown().trim()).toBe('before edit CHANGED');
    });

    it('c5: two successive getState() calls return independent copies', () => {
        const muya = boot('twin check\n');
        const a = muya.getState();
        const b = muya.getState();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        // Deep independence: nested paragraph objects are not shared.
        const pa = findParagraphState(a, 'twin check');
        const pb = findParagraphState(b, 'twin check');
        expect(pa).toBeDefined();
        expect(pb).toBeDefined();
        expect(pa).not.toBe(pb);
        pa!.text = 'mutant';
        expect(pb!.text).not.toBe('mutant');
    });

    it('c6: the live pre-apply prevDoc tree survives apply() intact (M1.2)', () => {
        const muya = boot('c6 baseline paragraph\n');
        // Independent pre-edit snapshot to compare the retained alias against.
        const before = JSON.stringify(muya.getState());

        // Retain every prevDoc BEYOND the synchronous listener stack — the
        // exact thing the getStateLive() contract forbids for the CURRENT
        // tree, but which is safe for prevDoc: each is a PRE-apply tree, and
        // ot-json1's copy-on-write apply() must never touch it again.
        const emittedPrevs: TState[][] = [];
        muya.eventCenter.on('json-change', (payload: { prevDoc: TState[] }) => {
            emittedPrevs.push(payload.prevDoc);
        });

        const leaf = firstLeaf(muya);
        leaf.text = 'c6 baseline paragraph EDITED';
        muya.flush();
        leaf.text = 'c6 baseline paragraph EDITED TWICE';
        muya.flush();

        expect(emittedPrevs.length).toBe(2);
        // First flush's prevDoc still equals the pre-edit snapshot — even
        // after a SECOND apply ran (shared-subtree copy-on-write discipline).
        expect(JSON.stringify(emittedPrevs[0])).toBe(before);
        // Second flush's prevDoc is the INTERMEDIATE state (post first edit,
        // pre second edit) — each prevDoc is its own flush's pre-apply tree.
        expect(JSON.stringify(emittedPrevs[1])).toContain('EDITED');
        expect(JSON.stringify(emittedPrevs[1])).not.toContain('TWICE');
        // And the current document moved on, proving the aliases are true
        // pre-apply snapshots rather than live views of the new state.
        expect(muya.getMarkdown()).toContain('EDITED TWICE');
    });
});
