import { readdirSync, readFileSync, statSync } from 'node:fs';

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The round-trip fixtures are compared byte-for-byte against the markdown the
// engine emits, which is always LF. A `core.autocrlf=true` checkout rewrites
// them to CRLF and three round-trip cases then fail locally while CI (LF) is
// green — the confusing part is that the failure looks like an engine bug.
// `.gitattributes` pins `text eol=lf` for this directory; this is the guard that
// fails loudly if that pin is ever lost or a fixture is committed with CRLF.

const FIXTURES = join(__dirname, 'fixtures', 'colamd-round-trip');

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? files(full) : [full];
    });
}

describe('round-trip fixture line endings', () => {
    it('has fixtures to check at all', () => {
        // A silently-empty glob would make the rest of this file vacuous.
        expect(files(FIXTURES).length).toBeGreaterThan(5);
    });

    it.each(files(FIXTURES))('%s contains no carriage return', (file) => {
        expect(readFileSync(file).includes(0x0D)).toBe(false);
    });
});
