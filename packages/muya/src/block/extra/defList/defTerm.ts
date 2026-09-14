import type { Muya } from '../../../muya';
import type { IDefTermState } from '../../../state/types';
import Format from '../../base/format';

/**
 * The `Term` part of a definition list — a `dt` leaf whose text is edited
 * inline, exactly like a paragraph content but with the term tag.
 */
class DefTerm extends Format {
    static override blockName = 'def-term';

    static create(muya: Muya, state: IDefTermState) {
        return new DefTerm(muya, state.text);
    }

    constructor(muya: Muya, text: string) {
        super(muya, text);
        this.tagName = 'dt';
        this.classList = ['mu-def-term'];
        this.createDomNode();
    }

    getState(): IDefTermState {
        return {
            name: 'def-term',
            text: this.text,
        };
    }
}

export default DefTerm;
