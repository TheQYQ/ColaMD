// Definition lists (pandoc / PHP Markdown Extra style, Typora parity):
//
//   Term
//   : Definition
//
// A def-list chunk is one or more `term line + `: `-prefixed definition
// lines` pairs, ended by a blank line or any other block. The extension is a
// BLOCK-level marked extension, so it must claim the chunk before marked's
// paragraph tokenizer swallows the `: def` lines into the term paragraph.

interface IDefItem {
    term: string;
    definitions: string[];
}

export interface IDefListToken {
    type: 'def-list';
    raw: string;
    items: IDefItem[];
}

// A definition line: `:` plus exactly one space/tab, definition text after
// (extra leading spaces end up in the captured text and are trimmed).
const DEF_LINE = /^ {0,3}:[ \t](.*)$/;
const BLANK_LINE = /^[ \t]*$/;

/**
 * Scan a def-list chunk starting at `src`. Returns the consumed items + raw
 * length, or null when `src` does not open with a `term / : definition` pair.
 * Continuation lines (a definition spanning several lines) are not supported —
 * a non-`: ` line ends the chunk.
 */
function scanDefList(src: string): { items: IDefItem[]; length: number } | null {
    const lines = src.split('\n');
    const items: IDefItem[] = [];
    let i = 0;

    while (i < lines.length) {
        const termLine = lines[i]!;

        // A blank line ends the chunk; a `: ` line with no preceding term is
        // not a def-list (and would loop forever below).
        if (BLANK_LINE.test(termLine) || DEF_LINE.test(termLine))
            break;

        const next = lines[i + 1];
        if (next === undefined || !DEF_LINE.test(next))
            return items.length > 0 ? { items, length: offsetOf(lines, i) } : null;

        const term = termLine;
        i++;
        const definitions: string[] = [];
        while (i < lines.length) {
            const defMatch = DEF_LINE.exec(lines[i]!);
            if (!defMatch)
                break;
            definitions.push(defMatch[1]!.trim());
            i++;
        }
        items.push({ term, definitions });
    }

    return items.length > 0 ? { items, length: offsetOf(lines, i) } : null;
}

/** Char length of the first `lineCount` lines (including their newlines). */
function offsetOf(lines: string[], lineCount: number): number {
    return lines.slice(0, lineCount).reduce((acc, line) => acc + line.length + 1, 0) - 1;
}

export default function () {
    return {
        extensions: [
            {
                name: 'def-list',
                level: 'block' as const,
                start(src: string) {
                    // A candidate is a line whose NEXT line starts with `: `.
                    const match = /^[^\n]+\n {0,3}:[ \t]/m.exec(src);
                    return match ? match.index : undefined;
                },
                tokenizer(src: string): IDefListToken | undefined {
                    const scanned = scanDefList(src);
                    if (!scanned)
                        return undefined;

                    return {
                        type: 'def-list',
                        raw: src.slice(0, scanned.length),
                        items: scanned.items,
                    };
                },
                renderer(
                    this: { parser: { parseInline: (src: string) => string } },
                    token: IDefListToken,
                ) {
                    const html = token.items
                        .map((item) => {
                            const dt = `<dt>${this.parser.parseInline(item.term)}</dt>`;
                            const dd = item.definitions
                                .map(def => `<dd>${this.parser.parseInline(def)}</dd>`)
                                .join('');
                            return dt + dd;
                        })
                        .join('');

                    return `<dl>${html}</dl>\n`;
                },
            },
        ],
    };
}
