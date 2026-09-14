import type { Muya } from '../../../muya';
import type { ITocBlockState, TState } from '../../../state/types';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const debug = logger('tocContainer:');

class TocContainer extends Parent {
    static override blockName = 'toc-container';

    static create(muya: Muya, state: ITocBlockState) {
        const tocContainer = new TocContainer(muya);

        const code = ScrollPage.loadBlock('code').create(muya, state);

        tocContainer.append(code);

        return tocContainer;
    }

    get lang() {
        // The raw `[toc]` marker is not highlighted.
        return '';
    }

    override get path() {
        const { path: pPath } = this.parent!;

        return [...pPath];
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'pre';
        this.classList = ['mu-toc-container'];
        this.createDomNode();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in tocContainer');
        return {} as TState;
    }
}

export default TocContainer;
