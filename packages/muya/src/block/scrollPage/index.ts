import type { Muya } from '../../muya';
import type { TState } from '../../state/types';
import type { Nullable } from '../../types';
import type Content from '../base/content';
import type TreeNode from '../base/treeNode';
import type { IConstructor, TBlockPath } from '../types';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { isHTMLElement, isMouseEvent } from '../../utils';
import logger from '../../utils/logger';
import Parent from '../base/parent';

const debug = logger('scrollpage:');

interface IBlurFocus {
    blur: Nullable<Content>;
    focus: Nullable<Content>;
}

export class ScrollPage extends Parent {
    private _blurFocus: IBlurFocus = { blur: null, focus: null };

    // Sorted-JSON snapshot of the reference labels the live blocks were last
    // rendered against; updateState's keyed path diffs it to re-inline-render
    // kept paragraphs when a definition changed outside the block tree.
    private _labelsSnapshot = '[]';

    static override blockName = 'scrollpage';

    // Registry of block constructors keyed by their static blockName.
    // Stored as Parent constructors — the overwhelming majority of
    // call sites do `loadBlock(...).create(...).append(child)`, which only
    // makes sense for Parent. Content leaves register themselves through
    // their containing Parent's create flow and don't go through
    // `loadBlock(...).create()` externally.
    private static _registeredBlocks = new Map<string, IConstructor<Parent>>();

    static register(Block: IConstructor<TreeNode>) {
        const { blockName } = Block;
        this._registeredBlocks.set(blockName, Block as IConstructor<Parent>);
    }

    // Returns the registered constructor. Asserts non-undefined for
    // callers (the registry is populated by `registerBlocks()` once at
    // `editor.init()` time, and `loadBlock` runs strictly after init.).
    // Mismatched names hit the warn branch and the caller crashes at
    // `.create()` — matches the original loose contract.
    static loadBlock(blockName: string): IConstructor<Parent> {
        const block = this._registeredBlocks.get(blockName);

        if (!block)
            debug.warn(`block:${blockName} is not existed.`);

        return block as IConstructor<Parent>;
    }

    static create(muya: Muya, state: TState[]) {
        const scrollPage = new ScrollPage(muya);

        scrollPage.append(
            ...state.map((block) => {
                return this.loadBlock(block.name).create(muya, block);
            }),
        );

        scrollPage.parent!.domNode!.appendChild(scrollPage.domNode!);

        return scrollPage;
    }

    override get path() {
        return [];
    }

    constructor(muya: Muya) {
        super(muya);
        // muya is not extends Parent, but it is the parent of scrollPage.
        // ScrollPage is the tree root; widening the base `TreeNode.parent`
        // declaration would ripple to every node, so spell out the boundary.
        // eslint-disable-next-line no-restricted-syntax
        this.parent = muya as unknown as Parent;
        this.tagName = 'div';
        this.classList = ['mu-container'];

        this.createDomNode();
        this._listenDomEvent();
    }

    override getState() {
        debug.warn('You can never call `getState` in scrollPage');

        return {} as TState;
    }

    private _listenDomEvent() {
        const { eventCenter } = this.muya;
        const { domNode } = this;

        eventCenter.attachDOMEvent(domNode!, 'click', this._clickHandler.bind(this));
    }

    updateState(state: TState[], options: { force?: boolean } = {}) {
        const { muya } = this;

        if (options.force) {
            // Full teardown + re-create, for callers whose change is NOT
            // reflected in the state JSON: locale refresh re-renders hint
            // attributes, option-driven re-renders (diagram vega theme)
            // re-invoke renderers. The keyed path below would keep every
            // byte-identical block and miss exactly those changes.
            this.empty();
            this.append(
                ...state.map((block) => {
                    return ScrollPage.loadBlock(block.name).create(muya, block);
                }),
            );
            const labels = this.muya.editor.inlineRenderer.refreshReferenceLabels();
            this._labelsSnapshot = JSON.stringify(
                [...labels.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            );
            return;
        }

        // SB (PERF-04) keyed reconcile. This method is the full-rebuild base
        // of setContent / _forceRender / undo-redo boundary rebuilds
        // (rebuildContents) / the updateContents error fallback, and used to
        // pay O(document) DOM work on every invocation (14.2s + 129k DOM
        // nodes at a 1MB doc — docs/perf-baseline.md). A live top-level
        // block's own getState() serializes byte-identical to the matching
        // jsonState item while their content is in sync (verified across a
        // 1,470-block doc), so an index-wise compare keeps every untouched
        // block and re-creates only the changed ones. All tree/DOM
        // mutations run with 'api' source — this path must never dispatch
        // history operations.
        const oldChildren: Parent[] = [];
        this.children.forEach(child => oldChildren.push(child as Parent));

        const keepCount = Math.min(oldChildren.length, state.length);

        // Truncate the surplus tail first: removals from the end keep the
        // linked-list positions of the survivors valid for the loop below.
        for (let i = oldChildren.length - 1; i >= keepCount; i--)
            this.removeChild(oldChildren[i], 'api');

        for (let i = 0; i < keepCount; i++) {
            const old = oldChildren[i];
            const item = state[i];
            if (old.blockName === item.name && JSON.stringify(old.getState()) === JSON.stringify(item))
                continue;

            old.replaceWith(ScrollPage.loadBlock(item.name).create(muya, item), 'api');
        }

        for (let i = keepCount; i < state.length; i++) {
            this.insertBefore(ScrollPage.loadBlock(state[i].name).create(muya, state[i]), null, 'api');
        }

        // Reference definitions are render inputs OUTSIDE the block tree: a
        // paragraph's text can be unchanged while its `[label]` anchor stops
        // (or starts) resolving because a definition elsewhere was added,
        // edited or dropped. Re-collect the labels and re-inline-render the
        // kept blocks that mention any affected label — the same mechanism
        // the incremental path uses (updateRefLinkAndImage).
        const labels = this.muya.editor.inlineRenderer.refreshReferenceLabels();
        const labelsSnapshot = JSON.stringify([...labels.entries()].sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
        ));
        if (labelsSnapshot !== this._labelsSnapshot) {
            const previous = new Map(
                JSON.parse(this._labelsSnapshot) as [string, { href: string }][],
            );
            const affected = new Set([...previous.keys(), ...labels.keys()]);
            for (const label of affected) this.updateRefLinkAndImage(label);
            this._labelsSnapshot = labelsSnapshot;
        }
    }

    /**
     * Find the content block by the path
     * @param {Array} path
     */
    queryBlock(path: TBlockPath) {
        if (path.length === 0)
            return this;

        const p = path.shift() as number;
        const block = this.find(p) as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined };
        return block && path.length ? block.queryBlock(path) : block;
    }

    updateRefLinkAndImage(label: string) {
        // The label is document content, so it must never reach the pattern as
        // syntax: `[a(b]: /u` throws during render (unterminated group), and a
        // label with nested quantifiers backtracks against every content block
        // on the main thread. Match the label literally.
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const REG = new RegExp(`\\[${escaped}\\](?!:)`);

        this.breadthFirstTraverse((node) => {
            if (node.isContent() && REG.test(node.text))
                node.update();
        });
    }

    handleBlurFromContent(block: Content) {
        this._blurFocus.blur = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    handleFocusFromContent(block: Content) {
        this._blurFocus.focus = block;
        requestAnimationFrame(this._updateActiveStatus);
    }

    private _updateActiveStatus = () => {
        const { blur, focus } = this._blurFocus;

        if (blur == null && focus == null)
            return;

        let needBlurBlocks: Parent[] = [];
        let needFocusBlocks: Parent[] = [];
        let block;

        if (blur && focus) {
            needFocusBlocks = focus.getAncestors();
            block = blur.parent;
            while (block && block.isParent && block.isParent() && !needFocusBlocks.includes(block)) {
                needBlurBlocks.push(block);
                block = block.parent;
            }
        }
        else if (blur) {
            needBlurBlocks = blur.getAncestors();
        }
        else if (focus) {
            needFocusBlocks = focus.getAncestors();
        }

        if (needBlurBlocks.length) {
            needBlurBlocks.forEach((b) => {
                b.active = false;
            });
        }

        if (needFocusBlocks.length) {
            needFocusBlocks.forEach((b) => {
                b.active = true;
            });
        }

        this._blurFocus = {
            blur: null,
            focus: null,
        };
    };

    // Create a new paragraph if click the blank area in editor.
    private _clickHandler(event: Event) {
        if (!isMouseEvent(event) || !isHTMLElement(event.target))
            return;

        const target = event.target;

        if (target[BLOCK_DOM_PROPERTY] === this) {
            const lastChild = this.lastChild as Parent;
            const lastContentBlock = lastChild.lastContentInDescendant()!;
            const { clientY } = event;
            const lastChildDom = lastChild.domNode;
            const { bottom } = lastChildDom!.getBoundingClientRect();

            if (clientY > bottom) {
                if (
                    lastChild.blockName === 'paragraph'
                    && lastContentBlock.text === ''
                ) {
                    lastContentBlock.setCursor(0, 0);
                }
                else {
                    const state = {
                        name: 'paragraph',
                        text: '',
                    };
                    const newNode = ScrollPage.loadBlock(state.name).create(
                        this.muya,
                        state,
                    );
                    this.append(newNode, 'user');
                    const cursorBlock = newNode.lastContentInDescendant();
                    cursorBlock.setCursor(0, 0, true);
                }
            }
        }
    }
}
