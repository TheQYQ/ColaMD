export interface IParagraphState {
    name: 'paragraph';
    text: string;
}

export interface IDefTermState {
    name: 'def-term';
    text: string;
}

export interface IDefDescState {
    name: 'def-desc';
    text: string;
}

export interface IDefListState {
    name: 'def-list';
    children: TState[];
}

export interface IAtxHeadingState {
    name: 'atx-heading';
    meta: {
        level: number;
    };
    text: string;
}

export interface ISetextHeadingState {
    name: 'setext-heading';
    meta: {
        level: number;
        underline: string; // "===" | "---";
    };
    text: string;
}

export interface IThematicBreakState {
    name: 'thematic-break';
    text: string;
}

export interface ICodeBlockState {
    name: 'code-block';
    meta: {
        type: string; // "indented" | "fenced";
        // The full fenced info string, verbatim (e.g. `js`, `js title="x"`, or a
        // Pandoc/RMarkdown `{…}` block). The language for highlighting is its
        // first word — derive via `firstWordOfInfo()`, never assume a single word.
        lang: string;
        fenceLength?: number;
    };
    text: string;
}

export interface IHtmlBlockState {
    name: 'html-block';
    text: string;
}

export interface IBlockQuoteState {
    name: 'block-quote';
    children: TState[];
}

export interface IListItemState {
    name: 'list-item';
    children: TState[];
}

export interface IOrderListState {
    name: 'order-list';
    meta: {
        start: number;
        loose: boolean;
        delimiter: string; // "." | ")";
    };
    children: IListItemState[];
}

export interface IBulletListState {
    name: 'bullet-list';
    meta: {
        marker: string; // "-" | "+" | "*";
        loose: boolean;
    };
    children: IListItemState[];
}

export interface ITableRowState {
    name: 'table.row';
    children: ITableCellState[];
}

export interface ITableCellMeta {
    align: string; // 'none' | 'left' | 'center' | 'right';
}

export interface ITableCellState {
    name: 'table.cell';
    meta: ITableCellMeta;
    text: string;
}

export interface ITableState {
    name: 'table';
    children: ITableRowState[];
}

export interface ITaskListItemMeta {
    checked: boolean;
}

export interface ITaskListItemState {
    name: 'task-list-item';
    meta: ITaskListItemMeta;
    children: TState[];
}

export interface ITaskListMeta {
    marker: string; // "-" | "+" | "*";
    loose: boolean;
}

export interface ITaskListState {
    name: 'task-list';
    meta: ITaskListMeta;
    children: ITaskListItemState[];
}

export interface IMathMeta {
    mathStyle: string; // "" | "gitlab";
}

export interface ITocBlockState {
    name: 'toc-block';
    text: string; // the raw `[toc]` marker as typed
}

export interface IMathBlockState {
    name: 'math-block';
    meta: IMathMeta;
    text: string;
}

export interface IFrontmatterMeta {
    lang: string; // "yaml" | "toml" | "json";
    style: string; //  "-" | "+" | ";" | "{";
}

export interface IFrontmatterState {
    name: 'frontmatter';
    meta: IFrontmatterMeta;
    text: string;
}

export interface IDiagramMeta {
    lang: string; // 'yaml' | 'json';
    type: 'mermaid' | 'plantuml' | 'vega-lite' | 'flowchart' | 'sequence';
}

export interface IDiagramState {
    name: 'diagram';
    meta: IDiagramMeta;
    text: string;
}

export interface IFootnoteBlockMeta {
    identifier: string;
}

export interface IFootnoteBlockState {
    name: 'footnote';
    meta: IFootnoteBlockMeta;
    children: TState[];
}

export type TLeafState
    = | IParagraphState
        | IDefTermState
        | IDefDescState
        | IAtxHeadingState
        | ISetextHeadingState
        | IThematicBreakState
        | ICodeBlockState
        | IHtmlBlockState
        | IMathBlockState
        | ITocBlockState
        | IFrontmatterState
        | IDiagramState
        | ITableCellState;

export type TContainerState
    = | IBlockQuoteState
        | IDefListState
        | IOrderListState
        | IBulletListState
        | ITableState
        | ITaskListState
        | ITaskListItemState
        | IListItemState
        | ITableRowState
        | IFootnoteBlockState;

export type TState = TLeafState | TContainerState;

export type CodeContentState = ICodeBlockState | IHtmlBlockState | IDiagramState | IMathBlockState | IFrontmatterState | ITocBlockState;

// Narrowing guards for the state union. Only the guards with real call sites
// are exported — add a new one when a consumer actually needs it.
export const isParagraphState = (s: TState): s is IParagraphState => s.name === 'paragraph';
export const isAtxHeadingState = (s: TState): s is IAtxHeadingState => s.name === 'atx-heading';
export const isCodeBlockState = (s: TState): s is ICodeBlockState => s.name === 'code-block';
export const isTableState = (s: TState): s is ITableState => s.name === 'table';
export const isTaskListItemState = (s: TState): s is ITaskListItemState => s.name === 'task-list-item';
export const isListItemState = (s: TState): s is IListItemState => s.name === 'list-item';
export const isFootnoteBlockState = (s: TState): s is IFootnoteBlockState => s.name === 'footnote';

export function isAnyListState(s: TState): s is IOrderListState | IBulletListState | ITaskListState {
    return s.name === 'order-list' || s.name === 'bullet-list' || s.name === 'task-list';
}

export interface ITurnoverOptions {
    headingStyle: 'atx' | 'setext'; // setext or atx
    hr: '---';
    bulletListMarker: '-' | '+' | '*'; // -, +, or *
    codeBlockStyle: 'fenced' | 'indented'; // fenced or indented
    fence: '```' | '~~~'; // ``` or ~~~
    emDelimiter: '*' | '_'; // _ or *
    strongDelimiter: '**' | '__'; // ** or __
    linkStyle: 'inlined';
    linkReferenceStyle: 'full';
    blankReplacement: (content: unknown, node: unknown, options: unknown) => string;
}
