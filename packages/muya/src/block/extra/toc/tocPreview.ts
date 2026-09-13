import type { Muya } from '../../../muya';
import type { ITocBlockState, TState } from '../../../state/types';
import { fromEvent } from 'rxjs';
import { escapeHTML } from '../../../utils';
import { getBlock } from '../../../utils/dom';
import Parent from '../../base/parent';

class TocPreview extends Parent {
    static override blockName = 'toc-preview';

    // Heading classes in document order — index of the clicked entry.
    private _headingSelector = '.mu-atx-heading, .mu-setext-heading';

    private _lastSignature = '';

    static create(muya: Muya, _state: ITocBlockState) {
        return new TocPreview(muya);
    }

    override get path() {
        return [];
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'div';
        this.classList = ['mu-toc-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        // First render must be async: blocks AFTER this one don't exist yet
        // while the document cascade is still building the tree.
        this._scheduleUpdate();
    }

    override getState(): TState {
        return {} as TState;
    }

    private _attachDOMEvents() {
        fromEvent(this.domNode!, 'click').subscribe(this.clickHandler.bind(this));
        // Headings appear/change on every structural edit — refresh the list
        // (rAF-coalesced + signature-gated inside `update`).
        this.muya.on('json-change', this._jsonChangeHandler);
    }

    private _updateScheduled = false;

    private _scheduleUpdate() {
        if (this._updateScheduled)
            return;
        this._updateScheduled = true;
        requestAnimationFrame(() => {
            this._updateScheduled = false;
            this.update();
        });
    }

    private _jsonChangeHandler = () => {
        this._scheduleUpdate();
    };

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target as HTMLElement | null;
        if (!target)
            return;

        const item = target.closest('li[data-index]');
        if (!item)
            return;

        const index = Number((item as HTMLElement).dataset.index);
        const heading = this.muya.domNode?.querySelectorAll(
            this._headingSelector,
        )[index];
        if (!heading)
            return;

        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Jump = navigate: place the caret at the heading start so typing /
        // outline highlight follow the jump. A failed block lookup (heading
        // not yet hydrated) degrades to scroll-only.
        const block = getBlock(heading);
        if (block?.isParent())
            block.firstContentInDescendant()?.setCursor(0, 0, true);
    }

    update() {
        if (!this.domNode)
            return;

        let items: Array<{ content: string; lvl: number }> = [];
        try {
            items = this.muya.getTOC();
        }
        catch {
            items = [];
        }

        const signature = items.map(item => item.content).join('\u0000');
        if (signature === this._lastSignature)
            return;
        this._lastSignature = signature;

        const html = items.length === 0
            ? `<div class="mu-toc-empty">${escapeHTML(this.muya.i18n.t('Empty Table of Contents'))}</div>`
            : `<ul class="mu-toc-list">${items
                .map(
                    (item, index) =>
                        `<li data-index="${index}" class="mu-toc-item mu-toc-h${Math.min(6, Math.max(1, item.lvl))}">${escapeHTML(item.content)}</li>`,
                )
                .join('')}</ul>`;

        this.domNode.innerHTML = html;
    }
}

export default TocPreview;
