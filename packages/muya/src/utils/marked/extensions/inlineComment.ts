const COMMENT_REG = /^(%%)((?:[^\n%]|%(?!%))+)(%%)/;

interface ICommentToken {
    type: string;
    raw: string;
    text: string;
    marker: string;
}

// Typora-style inline comment `%%text%%` for the HTML render paths (export /
// clipboard): the comment is content-free, so it serializes to an HTML comment
// and disappears from the rendered output while staying recoverable in source.
export default function () {
    return {
        extensions: [
            {
                name: 'inlineComment',
                level: 'inline' as const,
                start(src: string) {
                    const index = src.indexOf('%%');
                    if (index === -1)
                        return undefined;

                    const possibleComment = src.substring(index);
                    return COMMENT_REG.test(possibleComment) ? index : undefined;
                },
                tokenizer(src: string) {
                    const match = src.match(COMMENT_REG);
                    if (match) {
                        return {
                            type: 'inlineComment',
                            raw: match[0],
                            text: match[2].trim(),
                            marker: match[1],
                        };
                    }
                },
                renderer(token: ICommentToken) {
                    return `<!--${token.text}-->`;
                },
            },
        ],
    };
}
