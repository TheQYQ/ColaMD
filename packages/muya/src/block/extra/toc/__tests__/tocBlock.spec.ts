// @vitest-environment happy-dom

import type { Muya } from '../../../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../../../muya';

vi.mock('../../../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown });
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

async function bootMuyaAsync(markdown: string): Promise<Muya> {
    const muya = bootMuya(markdown);
    // The toc preview renders on a rAF after the whole tree exists.
    await new Promise(r => setTimeout(r, 30));
    return muya;
}

describe('toc block — [toc] marker', () => {
    it('converts a [toc] paragraph into a toc block and round-trips', async () => {
        const markdown = '# Alpha\n\n[toc]\n\n## Beta\n\ntext\n';
        const muya = await bootMuyaAsync(markdown);

        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.domNode.querySelector('figure.mu-toc-block')).toBeTruthy();
        expect(muya.domNode.querySelector('dl.mu-def-list')).toBeNull();
    });

    it('lists every heading of the document in the preview, in order', async () => {
        const muya = await bootMuyaAsync('# Alpha\n\n[toc]\n\n## Beta\n\ntext\n');
        const items = muya.domNode.querySelectorAll('.mu-toc-preview .mu-toc-item');

        expect([...items].map(el => el.textContent)).toEqual(['Alpha', 'Beta']);
    });

    it('stays a plain paragraph when the text is not exactly the marker', async () => {
        const muya = await bootMuyaAsync('see [toc] below\n');

        expect(muya.domNode.querySelector('figure.mu-toc-block')).toBeNull();
        expect(muya.getMarkdown()).toBe('see [toc] below\n');
    });
});
