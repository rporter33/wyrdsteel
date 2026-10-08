import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ROOT, walk, read, rel, importsOf, resolveSpec } from './_files';

// Layering: render, audio and ui read sim state and dispatch commands; they never step the world.
// Only src/game (the composition root) wires the loop to the sim.
const MUTATORS = ['src/core/sim/step', 'src/core/sim/world'];

const layers = ['src/render', 'src/audio', 'src/ui', 'src/platform'];

describe('layer boundaries', () => {
  for (const layer of layers) {
    for (const f of walk(join(ROOT, layer), ['.ts', '.tsx'])) {
      it(`${rel(f)} does not import sim mutators`, () => {
        for (const { spec, typeOnly } of importsOf(read(f))) {
          const target = resolveSpec(f, spec);
          if (!target || typeOnly) continue;
          for (const m of MUTATORS) expect(target.startsWith(m), `${rel(f)} imports ${target}`).toBe(false);
        }
      });
    }
  }

  it('platform does not import render or ui', () => {
    for (const f of walk(join(ROOT, 'src/platform'), ['.ts'])) {
      for (const { spec } of importsOf(read(f))) {
        const t = resolveSpec(f, spec);
        if (!t) continue;
        expect(t.startsWith('src/render') || t.startsWith('src/ui'), `${rel(f)} imports ${t}`).toBe(false);
      }
    }
  });
});
