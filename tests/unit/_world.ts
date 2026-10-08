import { db } from './_db';
import { createWorld, playerEntity, type StartSpec } from '../../src/core/sim/world';
import { step } from '../../src/core/sim/step';
import { emptyInput, type PlayerInput } from '../../src/core/input/frame';
import type { Entity, SimEvent, World } from '../../src/core/sim/types';

export function training(cls = 'berserker', seed = 7): { w: World; p: Entity } {
  const spec: StartSpec = { seed, players: [{ name: 'T', cls }], zone: 'training', node: 'training' };
  const w = createWorld(spec, db());
  return { w, p: playerEntity(w, 0)! };
}

/** Put the player 1.6 m south of an entity, facing it. */
export function standBefore(p: Entity, t: Entity, gap = 1.6): void {
  p.x = p.px = t.x;
  p.z = p.pz = t.z + t.r + p.r + gap - 0.9;
  p.fx = 0;
  p.fz = -1;
}

export function tickN(w: World, n: number, inp: Partial<PlayerInput> = {}): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(w, { tick: w.tick, inputs: [{ ...emptyInput(), ...inp }] }, db());
    out.push(...w.events);
  }
  return out;
}

export function press(w: World, btn: number, extra: Partial<PlayerInput> = {}): SimEvent[] {
  return tickN(w, 1, { pressed: btn, held: btn, ...extra });
}

export function dummies(w: World, def = 'dummy'): Entity[] {
  return w.entities.filter((e) => e.def === def);
}
