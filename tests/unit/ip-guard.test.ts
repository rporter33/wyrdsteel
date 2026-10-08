import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ROOT, walk, read, rel } from './_files';

// Wyrdsteel draws on Norse myth, which is public domain. It does not reuse the original game's
// name, faction phrasing, characters or level names. This keeps that true as content grows.
const BANNED = [/too\s*human/i, /children\s+of\s+ymir/i, /grndl/i, /silicon\s+knights/i, /\bbaldur\b/i, /ice forest/i, /hall of heroes/i];

const files = [...walk(join(ROOT, 'src'), ['.ts', '.tsx', '.json', '.css']), join(ROOT, 'index.html')];

describe('IP guard', () => {
  for (const f of files) {
    it(`${rel(f)} has no borrowed names`, () => {
      const src = read(f);
      for (const re of BANNED) expect(re.test(src), `${rel(f)} matches ${re}`).toBe(false);
    });
  }
});
