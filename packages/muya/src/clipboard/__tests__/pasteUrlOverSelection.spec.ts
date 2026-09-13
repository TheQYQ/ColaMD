// Smart paste (Typora parity): pasting a single URL over a non-empty selection
// wraps the selected text as `[text](url)` instead of replacing the selection
// with the bare URL.

// @vitest-environment happy-dom

import type { Muya } from '../../muya';
import { describe, expect, it, vi } from 'vitest';
import { URL_REG } from '../../config';
import Clipboard from '../index';
import { pastePlainText, pasteSelection } from '../paste';

function makeBlock(text: string, start: number, end: number) {
    const block = {
        blockName: 'paragraph.content' as string,
        text,
        getCursor: () => ({ start: { offset: start }, end: { offset: end } }),
        setCursor: vi.fn(),
        getAnchor: () => null,
        closestBlock: () => null,
        firstContentInDescendant: () => block,
        getState: () => ({ name: 'paragraph', text: block.text }),
        update: vi.fn(),
    };
    return block;
}

function makeClipboard(anchorBlock: ReturnType<typeof makeBlock>) {
    const clipboard = new Clipboard({
        options: { bulletListMarker: '-', frontMatter: true },
        editor: {},
    } as unknown as Muya);
    Object.defineProperty(clipboard, 'selection', {
        get: () => ({
            getSelection: () => ({ isSelectionInSameBlock: true, anchor: { block: anchorBlock } }),
            table: { hasSelection: false, getStateForCopy: () => null, clear: vi.fn() },
            image: null,
        }),
    });
    return clipboard;
}

function makePasteEvent(data: Record<string, string> = {}) {
    return {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clipboardData: {
            getData: (type: string) => data[type] ?? '',
            files: [],
            items: [],
        },
    } as unknown as ClipboardEvent;
}

describe('smart paste — URL over selection', () => {
    it('wraps the selected text as a link to the pasted URL', async () => {
        const block = makeBlock('select this end', 7, 11);
        const clipboard = makeClipboard(block);

        await pasteSelection(clipboard, makePasteEvent({ 'text/plain': 'https://example.com/foo' }));
        await new Promise(r => setTimeout(r, 20));

        expect(block.text).toBe('select [this](https://example.com/foo) end');
    });

    it('keeps the bare-URL behavior when the selection is collapsed', async () => {
        const block = makeBlock('hello world', 11, 11);
        const clipboard = makeClipboard(block);

        await pasteSelection(clipboard, makePasteEvent({ 'text/plain': 'https://example.com/foo' }));
        await new Promise(r => setTimeout(r, 20));

        // Collapsed cursor: the URL inserts itself (as an autolink), it never
        // wraps the preceding text.
        expect(block.text).toBe('hello worldhttps://example.com/foo');
    });

    it('percent-encodes parentheses in the destination', async () => {
        const block = makeBlock('select this end', 7, 11);
        const clipboard = makeClipboard(block);
        const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
        expect(URL_REG.test(url)).toBe(true);

        await pasteSelection(clipboard, makePasteEvent({ 'text/plain': url }));
        await new Promise(r => setTimeout(r, 20));

        expect(block.text).toBe('select [this](https://en.wikipedia.org/wiki/Foo_%28bar%29) end');
    });

    it('escapes brackets in the selected link text', async () => {
        const block = makeBlock('a [b] end', 2, 5);
        const clipboard = makeClipboard(block);

        await pasteSelection(clipboard, makePasteEvent({ 'text/plain': 'https://example.com/foo' }));
        await new Promise(r => setTimeout(r, 20));

        expect(block.text).toBe('a [\\[b\\]](https://example.com/foo) end');
    });

    it('is bypassed when pasting as plain text', async () => {
        const block = makeBlock('select this end', 7, 11);
        const clipboard = makeClipboard(block);

        await pastePlainText(clipboard, 'https://example.com/foo');
        await new Promise(r => setTimeout(r, 20));

        expect(block.text).toBe('select https://example.com/foo end');
    });
});
