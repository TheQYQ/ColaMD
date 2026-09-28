// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../../../../config/index';
import { Muya } from '../../../../muya';

const hosts: HTMLElement[] = [];

function bootMuya(markdown: string, options: Record<string, unknown> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, ...options } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

describe('autoNumberMathBlocks — container class plumbing', () => {
    afterEach(() => {
        for (const el of hosts.splice(0)) el.remove();
    });

    it('does not set the class by default', () => {
        const muya = bootMuya('# h');
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_NUMBER_MATH)).toBe(false);
    });

    it('sets the class at construction when the option is on', () => {
        const muya = bootMuya('# h', { autoNumberMathBlocks: true });
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_NUMBER_MATH)).toBe(true);
    });

    it('toggles the class through setOptions', () => {
        const muya = bootMuya('# h');
        muya.setOptions({ autoNumberMathBlocks: true });
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_NUMBER_MATH)).toBe(true);
        muya.setOptions({ autoNumberMathBlocks: false });
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_NUMBER_MATH)).toBe(false);
    });
});
