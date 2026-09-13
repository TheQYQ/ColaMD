import type { Muya } from '../../../muya';
import type { IDefListState } from '../../../state/types';
import { mixins } from '../../../utils';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

/**
 * Definition list (`Term` / `: Definition`, Typora parity). Flat `dl` parent:
 * children alternate `def-term` (dt) and `def-desc` (dd) leaves, mirroring the
 * HTML structure — no intermediate item block.
 */
@mixins(IContainerQueryBlock)
class DefList extends Parent {
    public override children: LinkedList<Parent> = new LinkedList();

    static override blockName = 'def-list';

    static create(muya: Muya, state: IDefListState) {
        const defList = new DefList(muya);

        defList.append(
            ...state.children.map(child =>
                ScrollPage.loadBlock(child.name).create(muya, child),
            ),
        );

        return defList;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'dl';
        this.classList = ['mu-def-list'];
        this.createDomNode();
    }

    override getState(): IDefListState {
        const state: IDefListState = {
            name: 'def-list',
            children: this.children.map(child => (child as Parent).getState()),
        };

        return state;
    }
}

export default DefList;
