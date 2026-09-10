// Deterministic markdown fixtures for keystroke-pipeline microbenches.
// Blocks are cycled so large docs mix headings, lists, code, CJK, bold,
// and links — not a pure-ASCII paragraph stream that would understate cost.

const SENTENCES = [
    '这是一个用于性能基准的中文段落，包含标点与英文 mix of words.',
    'The quick brown fox jumps over the lazy dog while typing **bold** text.',
    '链接示例：[文档](https://example.com/docs) 与 `inline code` 混排.',
    'Performance note: avoid quadratic full-document scans on every keystroke.',
    '更多中文内容以增加体积，模拟真实长文编辑场景，包括顿号、逗号，以及句号。',
    'A second English sentence with a [relative link](./notes.md) and more words to pad.',
];

/**
 * Build a markdown document whose serialized size is at least `targetBytes`.
 * Structure: H2/H3 headings, paragraphs, bullet lists, and fenced code —
 * the block mix a real notes file exercises on the hot path.
 */
export function makeDoc(targetBytes: number): string {
    const parts: string[] = [];
    let size = 0;
    let section = 0;

    while (size < targetBytes) {
        section += 1;

        const h2 = `## Section ${section} 小节标题\n\n`;
        parts.push(h2);
        size += h2.length;

        for (let p = 0; p < 4; p++) {
            const sentence = SENTENCES[(section + p) % SENTENCES.length];
            const para = `${sentence} (${section}.${p})\n\n`;
            parts.push(para);
            size += para.length;
        }

        const list = [
            `- item ${section}-a：${SENTENCES[section % SENTENCES.length]}`,
            `- item ${section}-b: second bullet with **emphasis**`,
            `- item ${section}-c`,
            ``,
        ].join('\n');
        parts.push(list);
        size += list.length;

        if (section % 3 === 0) {
            const code = [
                '```ts',
                `// block ${section}`,
                `export const n${section} = ${section};`,
                '```',
                ``,
            ].join('\n');
            parts.push(code);
            size += code.length;
        }

        if (section % 5 === 0) {
            const h3 = `### Sub ${section} 次级标题\n\n`;
            parts.push(h3);
            size += h3.length;
        }
    }

    return parts.join('');
}
