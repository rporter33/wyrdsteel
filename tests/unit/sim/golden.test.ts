import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../_db';
import { ROOT } from '../_files';
import { scenarios } from '../_scenarios';
import { createWorld } from '../../../src/core/sim/world';
import { step } from '../../../src/core/sim/step';
import { hashWorld } from '../../../src/core/sim/hash';
import { Recorder, runReplay, SIM_VERSION, type Replay } from '../../../src/core/input/replay';

// Golden replays: a scripted run's hash checkpoints are committed. A change that alters outcomes
// fails here; if the change is intended, `REBASELINE=1 npx vitest run golden` rewrites them for review.
const DIR = join(ROOT, 'tests/replays');

interface Golden {
  replay: Replay;
  final: string;
  summary: { hits: number; damage: number; kills: number };
}

describe('golden replays', () => {
  for (const sc of scenarios()) {
    it(`${sc.name} reproduces its committed hashes`, () => {
      const w = createWorld(sc.start, db());
      const rec = new Recorder(sc.start, db().hash, 60);
      const summary = { hits: 0, damage: 0, kills: 0 };
      for (const inputs of sc.frames) {
        const f = { tick: w.tick, inputs };
        step(w, f, db());
        rec.frame(f, w);
        for (const ev of w.events) {
          if (ev.k === 'hit' && ev.dmg > 0) {
            summary.hits++;
            summary.damage += ev.dmg;
          }
          if (ev.k === 'death') summary.kills++;
        }
      }
      const golden: Golden = { replay: rec.build(), final: hashWorld(w), summary };
      const file = join(DIR, `${sc.name}.json`);
      if (process.env.REBASELINE || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(golden, null, 1) + '\n');
        if (process.env.CI) throw new Error(`missing golden ${sc.name}; run REBASELINE=1 locally and commit`);
      }
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Golden;
      expect(saved.replay.simVersion).toBe(SIM_VERSION);
      expect(summary).toEqual(saved.summary);
      expect(golden.final).toBe(saved.final);
      // And the saved replay alone, re-run from its start spec, lands on the same checkpoints.
      const out = runReplay(saved.replay, db());
      expect(out.mismatch).toBeNull();
      expect(hashWorld(out.world)).toBe(saved.final);
    });
  }

  it('the scripted combo actually fights: hits land and damage is dealt', () => {
    const saved = JSON.parse(readFileSync(join(DIR, 'berserker-combo.json'), 'utf8')) as Golden;
    expect(saved.summary.hits).toBeGreaterThanOrEqual(8);
    const rifle = JSON.parse(readFileSync(join(DIR, 'commando-rifle.json'), 'utf8')) as Golden;
    expect(rifle.summary.hits).toBeGreaterThanOrEqual(5);
  });
});
