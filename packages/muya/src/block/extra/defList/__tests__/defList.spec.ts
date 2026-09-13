// @vitest-environment happy-dom

import type { Muya } from '../../../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../../../muya';
import { MarkdownToState } from '../../../../state/markdownToState';
import StateToMarkdown from '../../../../state/stateToMarkdown';

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

function bootMuya(markdown: string, options: Record<string, unknown> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown, ...options });
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

const DEFINITION_LIST = 'Term\ndefinition text\n\nTerm2\n: def A\n: def B\n';

describe('definition lists — parse gated by definitionList option', () => {
    it('parses term + : definition pairs into def-list state when enabled', () => {
        const states = new MarkdownToState({ definitionList: true, footnote: false, math: true, isGitlabCompatibilityEnabled: true, trimUnnecessaryCodeBlockEmptyLines: false, frontMatter: true }).generate(DEFINITION_LIST);

        expect(states[1]).toMatchObject({ name: 'def-list' });
        const defList = states[1] as { name: string; children: Array<{ name: string; text: string }> };
        expect(defList.children).toEqual([
            { name: 'def-term', text: 'Term2' },
            { name: 'def-desc', text: 'def A' },
            { name: 'def-desc', text: 'def B' },
        ]);
    });

    it('keeps the paragraph fallback when disabled', () => {
        const states = new MarkdownToState({ definitionList: false, footnote: false, math: true, isGitlabCompatibilityEnabled: true, trimUnnecessaryCodeBlockEmptyLines: false, frontMatter: true }).generate('Term2\n: def A\n');

        // Without the extension marked folds the `: def` line into the term's
        // paragraph as a soft line break — one paragraph, no def-list.
        expect(states.map(s => (s as { name: string }).name)).toEqual(['paragraph']);
        expect((states[0] as { text: string }).text).toBe('Term2\n: def A');
    });

    it('round-trips through the editor unchanged when enabled', () => {
        const muya = bootMuya(DEFINITION_LIST, { definitionList: true });
        expect(muya.getMarkdown()).toBe(DEFINITION_LIST);
        expect(muya.domNode.querySelector('dl.mu-def-list')).toBeTruthy();
        expect(muya.domNode.querySelectorAll('dt.mu-def-term')).toHaveLength(1);
        expect(muya.domNode.querySelectorAll('dd.mu-def-desc')).toHaveLength(2);
    });

    it('does not create a dl when disabled', () => {
        const muya = bootMuya('Term2\n: def A\n');
        expect(muya.domNode.querySelector('dl.mu-def-list')).toBeNull();
    });
});

describe('definition lists — stateToMarkdown', () => {
    it('re-emits the : prefixes', () => {
        const markdown = 'CSS props\n: flex\n: grid\n';
        const states = new MarkdownToState({ definitionList: true, footnote: false, math: true, isGitlabCompatibilityEnabled: true, trimUnnecessaryCodeBlockEmptyLines: false, frontMatter: true }).generate(markdown);
        const output = new StateToMarkdown({ listIndentation: 1 }).generate(states).trim();

        expect(output).toBe('CSS props\n: flex\n: grid');
    });
});
