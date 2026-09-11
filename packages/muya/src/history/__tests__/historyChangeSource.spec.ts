// @vitest-environment happy-dom

// Contract for the json-change `source` values the desktop's lazy-serialization
// pipeline keys on (M1.2b):
//   'user'    — a real user edit (typing, formatting, block commands)
//   'history' — an undo/redo replay (must be distinguishable: the desktop
//               resolves clean/dirty immediately because undo can land back on
//               the saved content — Phase G, G6)
//   'api'     — programmatic document swap (setContent / replaceContent)
// The replayed op MUST NOT carry the 'user' source: the desktop treats 'user'
// as "deterministically dirty, serialization deferred", which would lose the
// undo-back-to-saved-reads-clean property.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function firstContentBlock(muya: Muya) {
    // Runtime class is a Format content block; the declared return type of
    // firstContentInDescendant is the wider Content base.
    return muya.editor.scrollPage!.firstContentInDescendant() as unknown as {
        text: string;
        checkInlineUpdate: () => void;
    };
}

describe('json-change source contract for undo/redo replay', () => {
    it('dispatches undo/redo applies with source "history", edits with "user"', async () => {
        const muya = bootMuya('# anchor\n\nseed\n');
        const sources: string[] = [];
        muya.eventCenter.on('json-change', ({ source }: { source: string }) => {
            sources.push(source);
        });

        const para = firstContentBlock(muya);
        para.text = 'seed!';
        para.checkInlineUpdate();
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('seed!');
        });

        muya.undo();
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).not.toContain('!');
        });
        muya.redo();
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('!');
        });

        expect(sources).toEqual(['user', 'history', 'history']);
    });

    it('a history-sourced replay does not grow the undo stack', async () => {
        const muya = bootMuya('# anchor\n\nseed\n');
        const para = firstContentBlock(muya);
        para.text = 'seed!';
        para.checkInlineUpdate();
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('seed!');
        });

        // @ts-expect-error — reach into the private stack for test assertions.
        const depthAfterEdit = muya.editor.history._stack.undo.length;
        muya.undo();
        muya.redo();

        // @ts-expect-error — reach into the private stack for test assertions.
        expect(muya.editor.history._stack.undo.length).toBe(depthAfterEdit);
    });
});
