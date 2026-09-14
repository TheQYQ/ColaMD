// @vitest-environment happy-dom

import type { CodeEmojiMathToken } from '../types';
import { describe, expect, it } from 'vitest';
import { tokenizer } from '../lexer';

// LaTeX-style inline math delimiters `\(...\)` (Typora 1.11 parity). The span
// must lex as an `inline_math` token with marker `\(` when the
// `mathLatexDelimiters` option is on, and stay literal escaped parens when off.
function mathToken(src: string, mathLatexDelimiters: boolean): CodeEmojiMathToken | undefined {
    const tokens = tokenizer(src, {
        hasBeginRules: false,
        options: { superSubScript: true, footnote: false, mathLatexDelimiters },
    });
    return tokens.find(t => t.type === 'inline_math') as CodeEmojiMathToken | undefined;
}

describe('inline math — LaTeX delimiters \\(...\\)', () => {
    it('lexes \\(a+b\\) as inline math when enabled', () => {
        const token = mathToken('\\(a+b\\)', true);
        expect(token).toBeDefined();
        expect(token!.marker).toBe('\\(');
        expect(token!.content).toBe('a+b');
        expect(token!.raw).toBe('\\(a+b\\)');
        expect(token!.range).toEqual({ start: 0, end: 7 });
    });

    it('does not lex \\(a+b\\) as math when disabled', () => {
        expect(mathToken('\\(a+b\\)', false)).toBeUndefined();
    });

    it('keeps an unclosed \\( as plain escaped text when enabled', () => {
        const token = mathToken('\\(a+b', true);
        expect(token).toBeUndefined();
    });

    it('does not span a line break', () => {
        const tokens = tokenizer('\\(a\n+b\\)', {
            hasBeginRules: false,
            options: { superSubScript: true, footnote: false, mathLatexDelimiters: true },
        });
        expect(tokens.some(t => t.type === 'inline_math')).toBe(false);
    });

    it('still tokenizes $a+b$ unchanged when enabled', () => {
        const token = mathToken('$a+b$', true);
        expect(token).toBeDefined();
        expect(token!.marker).toBe('$');
        expect(token!.content).toBe('a+b');
    });
});
