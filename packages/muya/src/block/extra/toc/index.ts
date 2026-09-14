import type { Muya } from '../../../muya';
import type { ITocBlockState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

/**
 * In-document TOC block (`[toc]`, Typora parity). Renders a clickable heading
 * list preview; the raw `[toc]` marker stays editable in the container
 * (focus the figure to reveal it), mirroring the math block structure.
 */
class TocBlock extends Parent {
    static override blockName = 'toc-block';

    static create(muya: Muya, state: ITocBlockState) {
        const tocBlock = new TocBlock(muya);

        const tocPreview = ScrollPage.loadBlock('toc-preview').create(
            muya,
            state,
        );
        const tocContainer = ScrollPage.loadBlock('toc-container').create(
            muya,
            state,
        );

        tocBlock.appendAttachment(tocPreview);
        tocBlock.append(tocContainer);

        return tocBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'figure';
        this.classList = ['mu-toc-block'];
        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    override getState(): ITocBlockState {
        const text = this.firstContentInDescendant()?.text;

        return {
            name: 'toc-block',
            text: text ?? '[toc]',
        };
    }
}

export default TocBlock;
