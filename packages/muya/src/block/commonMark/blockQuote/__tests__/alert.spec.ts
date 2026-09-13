// @vitest-environment happy-dom

import type { Muya } from '../../../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../../../muya';
import { alertMarkerType } from '../alert';

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

describe('gitHub alerts — block quote callout', () => {
    it('marks the block quote DOM as a note alert', () => {
        const muya = bootMuya('> [!NOTE]\n> Watch out — highlighted content\n');
        const quote = muya.domNode.querySelector('blockquote');
        expect(quote?.classList.contains('mu-alert')).toBe(true);
        expect(quote?.classList.contains('mu-alert-note')).toBe(true);
    });

    it('round-trips the alert markdown untouched', () => {
        const markdown = '> [!TIP]\n> Useful advice\n';
        const muya = bootMuya(markdown);
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('does not alert an ordinary block quote', () => {
        const muya = bootMuya('> just a quote\n');
        const quote = muya.domNode.querySelector('blockquote');
        expect(quote?.classList.contains('mu-alert')).toBe(false);
    });

    it('ignores an alert marker that is not the first paragraph', () => {
        const muya = bootMuya('> text first\n\n> [!WARNING]\n');
        const quotes = muya.domNode.querySelectorAll('blockquote');
        expect(quotes[0]?.classList.contains('mu-alert')).toBe(false);
    });
});

describe('alertMarkerType', () => {
    it('detects the five marker kinds case-insensitively', () => {
        expect(alertMarkerType('[!NOTE]')).toBe('note');
        expect(alertMarkerType('[!tip]\ncontent')).toBe('tip');
        expect(alertMarkerType('[!Important]')).toBe('important');
        expect(alertMarkerType('[!WARNING]')).toBe('warning');
        expect(alertMarkerType('[!CAUTION]\n')).toBe('caution');
    });

    it('rejects non-markers', () => {
        expect(alertMarkerType('plain text')).toBeNull();
        expect(alertMarkerType('[!NOTICE]')).toBeNull();
        expect(alertMarkerType('text [!NOTE]')).toBeNull();
    });
});
