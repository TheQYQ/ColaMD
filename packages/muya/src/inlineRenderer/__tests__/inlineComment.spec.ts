// @vitest-environment happy-dom

import type { InlineCommentToken } from '../types';
import { describe, expect, it } from 'vitest';
import { tokenizer } from '../lexer';

// Typora-style inline comment `%%text%%`. Lexes as an `inline_comment` token
// only when the `inlineComment` option is on; stays literal text when off.
function commentToken(src: string, inlineComment: boolean): InlineCommentToken | undefined {
    const tokens = tokenizer(src, {
        hasBeginRules: false,
        options: { superSubScript: true, footnote: false, inlineComment },
    });
    return tokens.find(t => t.type === 'inline_comment') as InlineCommentToken | undefined;
}

describe('inline comment %%text%%', () => {
    it('lexes %%note%% when enabled', () => {
        const token = commentToken('a %%note%% b', true);
        expect(token).toBeDefined();
        expect(token!.marker).toBe('%%');
        expect(token!.content).toBe('note');
        expect(token!.raw).toBe('%%note%%');
    });

    it('stays literal text when disabled', () => {
        expect(commentToken('a %%note%% b', false)).toBeUndefined();
    });

    it('allows single % inside the comment', () => {
        const token = commentToken('%%50% off%%', true);
        expect(token).toBeDefined();
        expect(token!.content).toBe('50% off');
    });

    it('does not span a line break', () => {
        const tokens = tokenizer('%%note\nmore%%', {
            hasBeginRules: false,
            options: { superSubScript: true, footnote: false, inlineComment: true },
        });
        expect(tokens.some(t => t.type === 'inline_comment')).toBe(false);
    });

    it('requires a closing delimiter', () => {
        expect(commentToken('%%unclosed', true)).toBeUndefined();
    });
});
