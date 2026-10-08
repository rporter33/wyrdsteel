import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { chaosInputs, hold } from '../_drive';
import { createWorld, playerEntity, type StartSpec } from '../../../src/core/sim/world';
import { step } from '../../../src/core/sim/step';
import { hashWorld } from '../../../src/core/sim/hash';
import { snapshot, restore } from '../../../src/core/sim/snapshot';
import { Recorder, runReplay, encodeFrames, decodeFrames } from '../../../src/core/input/replay';
import type { PlayerInput } from '../../../src/core/input/frame';
import type { World } from '../../../src/core/sim/types';

const spec: StartSpec = { seed: 1234, players: [{ name: 'Test', cls: 'berserker' }], zone: 'training', node: 'training' };

function run(w: World, frames: PlayerInput[][]): World {
  for (const inputs of frames) step(w, { tick: w.tick, inputs }, db());
  return w;
}

describe('determinism', () => {
  const frames = chaosInputs(99, 900);

  it('same inputs give the same hash', () => {
    const a = run(createWorld(spec, db()), frames);
    const b = run(createWorld(spec, db()), frames);
    expect(a.tick).toBe(900);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('snapshot and restore mid-run continues identically (rollback readiness)', () => {
    const a = createWorld(spec, db());
    run(a, frames.slice(0, 450));
    const snap = snapshot(a);
    run(a, frames.slice(450));
    const b = restore(snap);
    run(b, frames.slice(450));
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('different seeds or inputs diverge', () => {
    const a = run(createWorld(spec, db()), frames);
    const b = run(createWorld(spec, db()), chaosInputs(100, 900));
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('a recorded replay reproduces the run and its checkpoints', () => {
    const w = createWorld(spec, db());
    const rec = new Recorder(spec, db().hash, 60);
    for (const inputs of frames) {
      const f = { tick: w.tick, inputs };
      step(w, f, db());
      rec.frame(f, w);
    }
    const replay = rec.build();
    expect(replay.frames.length).toBeLessThan(frames.length);
    const out = runReplay(replay, db());
    expect(out.mismatch).toBeNull();
    expect(hashWorld(out.world)).toBe(hashWorld(w));
  });

  it('a tampered checkpoint pinpoints the desync tick', () => {
    const w = createWorld(spec, db());
    const rec = new Recorder(spec, db().hash, 60);
    for (const inputs of frames.slice(0, 300)) {
      const f = { tick: w.tick, inputs };
      step(w, f, db());
      rec.frame(f, w);
    }
    const replay = rec.build();
    replay.checkpoints[2]!.hash = 'deadbeefdeadbeef';
    expect(runReplay(replay, db()).mismatch?.tick).toBe(180);
  });

  it('RLE round-trips frames', () => {
    const f = [...hold(127, 0, 30), ...frames.slice(0, 50), ...hold(0, 0, 10)];
    expect(decodeFrames(encodeFrames(f))).toEqual(f);
  });
});

describe('movement', () => {
  it('holding right moves the player right at about class speed', () => {
    const w = createWorld(spec, db());
    const e = playerEntity(w, 0)!;
    const x0 = e.x;
    run(w, hold(127, 0, 60));
    expect(e.x - x0).toBeGreaterThan(5.5);
    expect(e.x - x0).toBeLessThan(6.9);
    expect(e.fx).toBeCloseTo(1, 5);
  });

  it('walls stop the player', () => {
    const w = createWorld(spec, db());
    const e = playerEntity(w, 0)!;
    run(w, hold(-127, 0, 600));
    expect(e.x).toBeGreaterThanOrEqual(1 + e.r - 1e-9);
    expect(e.x).toBeLessThan(1 + e.r + 0.01);
  });

  it('dodge travels about 4 m and grants i-frames, two charges then recharge', async () => {
    const { BTN } = await import('../../../src/core/input/frame');
    const w = createWorld(spec, db());
    const e = playerEntity(w, 0)!;
    const x0 = e.x;
    run(w, [[{ mx: 127, mz: 0, ax: 0, az: 0, held: BTN.dodge, pressed: BTN.dodge }]]);
    let sawIframes = false;
    for (let i = 0; i < 30; i++) {
      run(w, hold(0, 0, 1));
      if (e.iframes) sawIframes = true;
    }
    expect(sawIframes).toBe(true);
    expect(e.x - x0).toBeGreaterThan(3.6);
    expect(e.x - x0).toBeLessThan(4.6);
    expect(e.pl!.dodges).toBe(1);
  });
});
