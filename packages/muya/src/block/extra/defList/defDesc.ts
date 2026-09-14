import type { Muya } from '../../../muya';
import type { IDefDescState } from '../../../state/types';
import Format from '../../base/format';

/**
 * The `: Definition` part of a definition list — a `dd` leaf. The `: ` marker
 * itself lives only in the markdown serialization (see stateToMarkdown), not
 * in the block text.
 */
class DefDesc extends Format {
    static override blockName = 'def-desc';

    static create(muya: Muya, state: IDefDescState) {
        return new DefDesc(muya, state.text);
    }

    constructor(muya: Muya, text: string) {
        super(muya, text);
        this.tagName = 'dd';
        this.classList = ['mu-def-desc'];
        this.createDomNode();
    }

    getState(): IDefDescState {
        return {
            name: 'def-desc',
            text: this.text,
        };
    }
}

export default DefDesc;
