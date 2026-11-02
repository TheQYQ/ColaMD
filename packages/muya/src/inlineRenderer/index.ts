import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { IHighlight, Labels } from './types';
import { escapeHTML } from '../utils';
import logger from '../utils/logger';
import { tokenizer } from './lexer';
import Renderer from './renderer';
import { beginRules } from './rules';

const debug = logger('inlineRenderer:');

// ponytail: the char-by-char lexer is polynomial on pathological input (one
// multi-hundred-KB paragraph, audit P2). Above this threshold a block renders
// as escaped plain text — inline formatting inside a giant paragraph
// degrades, the renderer stays responsive. Chunk the lexer instead if real
// documents ever get close.
const INLINE_RENDER_TEXT_LIMIT = 20000;

class InlineRenderer {
    public labels: Labels = new Map();
    public renderer: Renderer;

    constructor(public muya: Muya) {
        this.renderer = new Renderer(muya, this);
    }

    private _tokenizer(block: Format, highlights: IHighlight[]) {
        const { options } = this.muya;
        const { text } = block;
        const { labels } = this;

        // TODO: different content block should have different rules.
        // eg: atxheading.content has no soft|hard line break
        // setextheading.content has no heading rules.
        const hasBeginRules
            = /thematicbreak\.content|paragraph\.content|atxheading\.content/.test(
                block.blockName,
            );

        return tokenizer(text, { hasBeginRules, labels, options, highlights });
    }

    /**
     * Flush every cached image and force inline images to reload.
     *
     * The renderer memoises loaded images in `loadImageMap` (keyed by src,
     * skipped on the next render once `isSuccess` is true) and resolved URLs
     * in `urlMap`. When an image file changes on disk the cached entry would
     * otherwise keep the stale bitmap, so clearing both maps and re-rendering
     * every content block re-runs `loadImageAsync`, which loads the source
     * afresh.
     */
    invalidateImageCache() {
        this.renderer.loadImageMap.clear();
        this.renderer.urlMap.clear();

        const { scrollPage } = this.muya.editor;
        if (!scrollPage)
            return;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                node.update();
        });
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this._collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        if (block.text.length > INLINE_RENDER_TEXT_LIMIT) {
            debug.error(`block text over ${INLINE_RENDER_TEXT_LIMIT} chars — rendering as plain text`);
            domNode!.innerHTML = escapeHTML(block.text);
            return;
        }

        const tokens = this._tokenizer(block, highlights);
        const html = this.renderer.output(
            tokens,
            block,
            cursor && cursor.block === block ? cursor : {},
        );
        domNode!.innerHTML = html;
    }

    // PERF-09 (#GUI-B7): the reference-definition labels used to rebuild on
    // EVERY patched block — one full-tree walk per content block per render,
    // K x O(N) for a K-block update on an N-paragraph document. The Map is now
    // cached against the jsonState revision (bumped on every state mutation)
    // and rebuilt at most once per document change.
    private _labelsCache: Map<string, { href: string; title: string }> | null = null;
    private _labelsRevision = -1;

    /**
     * Re-collect the reference-definition labels from the json state (cached
     * against the state revision) and return the live map.
     *
     * SB: ScrollPage's keyed reconcile keeps paragraphs whose TEXT is
     * unchanged, but reference definitions are render inputs that live
     * outside the block tree - after a definition is added, edited or
     * dropped, kept paragraphs must re-inline-render even though their state
     * compare matched.
     */
    public refreshReferenceLabels(): Labels {
        this._collectReferenceDefinitions();
        return this.labels;
    }

    private _collectReferenceDefinitions() {
        const revision = this.muya.editor.jsonState.revision;
        if (this._labelsCache && this._labelsRevision === revision) {
            this.labels = this._labelsCache;
            return;
        }
        // Read-only traversal of the live tree: this method extracts label/info
        // strings into a fresh Map and retains nothing else (no state refs
        // survive this call), so the deep clone is unnecessary on the
        // per-keystroke path (see docs/getState-callers.md §1 #1).
        const state = this.muya.editor.jsonState.getStateLive();
        const labels = new Map();

        const travel = (sts: TState[]) => {
            if (Array.isArray(sts) && sts.length) {
                for (const st of sts) {
                    if (st.name === 'paragraph') {
                        const { label, info } = this.getLabelInfo(st);
                        if (label && info)
                            labels.set(label, info);
                    }
                    else if ((st as TContainerState).children) {
                        travel((st as TContainerState).children);
                    }
                }
            }
        };

        travel(state);

        this._labelsCache = labels;
        this._labelsRevision = revision;
        this.labels = labels;
    }

    getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
        const { text } = blockOrState;
        const tokens = beginRules.reference_definition.exec(text);
        let label = null;
        let info = null;
        if (tokens) {
            label = (tokens[2] + tokens[3]).toLowerCase();
            info = {
                href: tokens[6],
                title: tokens[10] || '',
            };
        }

        return { label, info };
    }
}

export default InlineRenderer;
