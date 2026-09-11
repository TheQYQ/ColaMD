import type { Token } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import fm from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

/**
 * Walk every token (pre-order) and apply the muya per-token visitor.
 *
 * This mirrors `Marked#walkTokens`, but WITHOUT the accumulator: marked
 * concatenates a result array on every token (`n = n.concat(...)` in its
 * source), which is quadratic in the token count — a 1MB document (~20k block
 * tokens) spent ~1.8s inside it, dominating setContent (M1.3). Muya's visitor
 * is stateless and its return value was discarded, so visiting in place is
 * behaviorally identical. Child traversal mirrors marked's own: table
 * header/rows cells, list items, then the generic `tokens` array.
 */
function walkAllTokens(
    tokens: Token[] | undefined,
    visit: (token: Token) => void,
): void {
    if (!tokens || !tokens.length)
        return;

    for (const token of tokens) {
        visit(token);

        switch (token.type) {
            case 'table': {
                // Table cells hold inline tokens (no headings/code), but
                // walking them keeps parity with marked's traversal.
                const table = token as Token & {
                    header: { tokens?: Token[] }[];
                    rows: { tokens?: Token[] }[][];
                };
                for (const cell of table.header)
                    walkAllTokens(cell.tokens, visit);
                for (const row of table.rows) {
                    for (const cell of row)
                        walkAllTokens(cell.tokens, visit);
                }
                break;
            }
            case 'list': {
                const list = token as Token & { items: { tokens?: Token[] }[] };
                for (const item of list.items)
                    walkAllTokens(item.tokens, visit);
                break;
            }
            default: {
                walkAllTokens(
                    (token as Token & { tokens?: Token[] }).tokens,
                    visit,
                );
            }
        }
    }
}

export function lexBlock(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexedToken[] {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { math, frontMatter, footnote } = options;
    const tokens: (Token | IFrontmatterToken)[] = [];

    // Use a per-call Marked instance so extensions don't bleed across calls.
    // marked.use() on the global singleton would make math / footnote sticky:
    // any consumer that once passed `math: true` would get math parsing forever.
    const m = new Marked();

    if (math) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (footnote) {
        m.use(footnoteExtension());
    }

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    // Pass `m.defaults` to the Lexer so the extensions registered via m.use()
    // are picked up; the no-arg constructor would fall back to global defaults.
    tokens.push(...new m.Lexer(m.defaults).blockTokens(src));
    const tokenList = compatibleTaskList(tokens as Token[]);
    walkAllTokens(tokenList, walkTokens(options));

    // After walkTokens / compatibleTaskList run, marked's Heading/List/ListItem
    // tokens have been augmented with muya-specific fields (headingStyle,
    // marker, listType, listItemType, bulletMarkerOrDelimiter). The wider
    // TLexedToken union captures that runtime shape.
    return tokenList as TLexedToken[];
}
