// @vitest-environment happy-dom

// IMG.1 — `Format.deleteImage` must emit `image-deleted` with the removed
// image's src so the desktop layer can clean up the underlying file (after
// its own reference/domain/preference checks). The hand-built token is
// sufficient here: deleteImage consumes only `token.range` and `token.src`.

import type Format from '../format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

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

describe('deleteImage emits image-deleted (IMG.1)', () => {
    it('emits the image src and removes the markdown reference', () => {
        const muya = bootMuya('![logo](./assets/logo.png) end\n');
        const content = muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;

        const events: { src: string }[] = [];
        muya.eventCenter.on('image-deleted', (payload: { src: string }) => {
            events.push(payload);
        });

        // '![logo](./assets/logo.png)' spans characters 0..26.
        content.deleteImage({
            token: {
                type: 'image',
                range: { start: 0, end: 26 },
                src: './assets/logo.png',
            },
            imageId: 'test-image',
        } as unknown as Parameters<Format['deleteImage']>[0]);

        expect(content.text).toBe(' end');
        expect(events).toEqual([{ src: './assets/logo.png' }]);
    });

    it('emits for data URIs too — the receiver filters them out', () => {
        const muya = bootMuya('![dot](data:image/png;base64,AAAA)\n');
        const content = muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;

        const events: { src: string }[] = [];
        muya.eventCenter.on('image-deleted', (payload: { src: string }) => {
            events.push(payload);
        });

        content.deleteImage({
            token: {
                type: 'image',
                range: { start: 0, end: 35 },
                src: 'data:image/png;base64,AAAA',
            },
            imageId: 'test-image',
        } as unknown as Parameters<Format['deleteImage']>[0]);

        expect(events).toEqual([{ src: 'data:image/png;base64,AAAA' }]);
    });
});
