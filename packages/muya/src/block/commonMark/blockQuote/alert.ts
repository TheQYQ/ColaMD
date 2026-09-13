// GitHub alerts (`> [!NOTE]` …, Typora 1.10 parity): a block-quote whose
// FIRST paragraph starts with a marker line renders as a colored callout.
// The class lives on the block-quote DOM node; the paragraph content block
// re-syncs it on every text change (see paragraphContent.update), and
// `BlockQuote.create` seeds it when the document loads.

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

// Marker at paragraph start, alone on its line (`[!NOTE]` + end of text) or
// followed by a soft line break (`[!NOTE]\ncontent` — marked keeps the whole
// blockquote paragraph as one text with `\n`).
const ALERT_MARKER_REG = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?=$|\n|\s*$)/i;

/**
 * The alert type a paragraph text announces (`note` | … | null).
 */
export function alertMarkerType(text: string): AlertType | null {
    const match = ALERT_MARKER_REG.exec(text);
    if (!match)
        return null;

    return match[1]!.toLowerCase() as AlertType;
}

/**
 * Sync the `mu-alert mu-alert-{type}` classes on a block-quote DOM node.
 * Always clears the other types first so a marker edit switches cleanly.
 */
export function syncAlertClassName(domNode: HTMLElement, type: AlertType | null): void {
    for (const t of ALERT_TYPES) {
        if (t !== type && domNode.classList.contains(`mu-alert-${t}`))
            domNode.classList.remove(`mu-alert-${t}`);
    }

    if (type)
        domNode.classList.add(`mu-alert-${type}`);

    if (type)
        domNode.classList.add('mu-alert');
    else
        domNode.classList.remove('mu-alert');
}
