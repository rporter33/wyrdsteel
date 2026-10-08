import type { BossDef } from '../data/types';
import type { BossComp, Entity, World } from '../sim/types';
import { msToTicks } from '../sim/constants';

/** A boss's starting state: phase 1, fully plated, nothing read yet. */
export function newBoss(e: Entity, bd: BossDef): BossComp {
  const platingMax = Math.round(e.hpMax * bd.plating);
  return {
    phase: 1,
    floor: Math.round(e.hpMax * (bd.phases[0] ?? 0)),
    pattern: '',
    step: 0,
    history: [],
    invuln: 0,
    heat: 0,
    exposed: 0,
    plating: platingMax,
    platingMax,
    read: '',
    obsT: 0,
    seq: 0,
    collapse: 0,
    cx: e.x,
    cz: e.z,
  };
}

/** A broken channel: the guardian reels and starts its count again. */
export function interruptChannel(w: World, e: Entity): void {
  const ai = e.ai!;
  ai.st = 'recover';
  ai.t = 0;
  ai.c = 0;
  e.act = null;
  e.stun = Math.max(e.stun, msToTicks(1500));
  e.stunKind = 1;
  w.events.push({ k: 'boss', t: w.tick, what: 'interrupt', value: '' });
  w.events.push({ k: 'stagger', t: w.tick, dst: e.id, down: false });
}
