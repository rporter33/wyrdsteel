import { describe, expect, it } from 'vitest';
import { ROOT, walk, read, rel, stripComments, importsOf, resolveSpec } from './_files';
import { join } from 'node:path';

// The sim must give bit-identical results on every browser, or co-op lockstep desyncs. These
// APIs are either nondeterministic or not pinned down by IEEE 754 to the last bit.
const BANNED: [RegExp, string][] = [
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log2|log10|log1p|hypot|cbrt|random)\b/, 'non-deterministic Math'],
  [/\*\*/, 'the ** operator (use ipow)'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [/\b(window|document|navigator|localStorage|indexedDB|requestAnimationFrame|setTimeout|setInterval)\b/, 'browser globals'],
  [/\bnew Map\b|\bnew Set\b/, 'Map/Set in sim state (iteration order hazards; use arrays)'],
];

const coreFiles = walk(join(ROOT, 'src/core'), ['.ts']);

describe('core purity', () => {
  it('has files to check', () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  for (const f of coreFiles) {
    it(`${rel(f)} uses only deterministic APIs`, () => {
      const src = stripComments(read(f));
      for (const [re, what] of BANNED) {
        if (what.startsWith('Map/Set') && /\/\/ pure-cache/.test(read(f))) continue;
        expect(re.test(src), `${rel(f)} uses ${what}`).toBe(false);
      }
    });

    it(`${rel(f)} imports only from src/core`, () => {
      for (const { spec } of importsOf(read(f))) {
        const target = resolveSpec(f, spec);
        expect(target, `${rel(f)} imports package "${spec}"`).not.toBeNull();
        expect(target!.startsWith('src/core/'), `${rel(f)} imports ${target}`).toBe(true);
      }
    });
  }
});
