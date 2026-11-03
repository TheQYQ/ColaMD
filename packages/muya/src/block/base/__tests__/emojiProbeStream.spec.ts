import { describe, expect, it } from 'vitest';
import { tokenizer } from '../../../inlineRenderer/lexer';

// #127: PERF-08 made the emoji probe reuse the caller's `tokensNew` stream
// (labels + begin rules on) instead of the old `hasBeginRules: false` stream.
// The only documented divergence risk is a paragraph whose first line is a
// link reference definition. The probe only compares token type + range at the
// caret, so comparing the emoji token's range/content between the two option
// shapes is enough to decide equivalence without booting a DOM editor.

function emojiToken(text: string, options: Record<string, unknown>): unknown {
    const tokens = tokenizer(text, { options: {} as never, ...options });
    return tokens.find(token => token.type === 'emoji');
}

describe('emoji probe token streams (#127)', () => {
    const texts = [
        ':smile:',
        '[foo]: /url\n:smile:',
        '[foo]: /url\n\n:smile:',
        '[foo]: /url\n\nhello :smile:',
        '[foo]: /url\n\nhello :smile: world',
        '[foo]: /url\n[bar]: /baz\n\n:smile:',
    ];

    for (const text of texts) {
        it(`matches for ${JSON.stringify(text)}`, () => {
            const withoutBeginRules = emojiToken(text, { hasBeginRules: false });
            const withLabelsAndBeginRules = emojiToken(text, { labels: new Map() });
            expect(withLabelsAndBeginRules).toEqual(withoutBeginRules);
        });
    }
});
