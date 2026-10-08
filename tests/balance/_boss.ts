import { db } from '../unit/_db';
import { createWorld } from '../../src/core/sim/world';
import { step } from '../../src/core/sim/step';
import { botInput, newMemory, type Policy } from '../../src/core/bot/policies';
import type { CharacterState } from '../../src/core/progression/character';
import type { SimEvent } from '../../src/core/sim/types';

export interface BossRun {
  won: boolean;
  seconds: number;
  phase: number;
  maxHitFrac: number;
  patterns: string[];
  reads: string[];
  plated: number;
  interrupts: number;
  hitBy: Record<string, number>;
  flasks: number;
}

/** One attempt at the caldera: from the entrance until the boss falls or the bot does. */
export function runBoss(character: CharacterState, policy: Policy, seed: number, zone = 'roots', maxMinutes = 10): BossRun {
  const d = db();
  const w = createWorld({ seed, players: [{ name: 'Bot', cls: character.cls, character: structuredClone(character) }], zone, node: 'caldera' }, d);
  const mem = newMemory();
  let events: SimEvent[] = [];
  const run: BossRun = { won: false, seconds: 0, phase: 1, maxHitFrac: 0, patterns: [], reads: [], plated: 0, interrupts: 0, hitBy: {}, flasks: 0 };
  let started = -1;
  for (let t = 0; t < 60 * 60 * maxMinutes; t++) {
    step(w, { tick: w.tick, inputs: [botInput(w, d, 0, policy, mem, events)] }, d);
    events = w.events;
    for (const ev of events) {
      if (ev.k === 'hit' && ev.dst === w.players[0]!.entity) {
        const src = w.entities.find((e) => e.id === ev.src);
        const key = src ? `${src.def}:${src.act?.id ?? '-'}` : 'env';
        run.hitBy[key] = (run.hitBy[key] ?? 0) + ev.dmg;
      }
      if (ev.k === 'playerDown') return finish(run, w, started, false);
      if (ev.k !== 'boss') continue;
      if (ev.what === 'phase') {
        run.phase = Number(ev.value);
        if (started < 0) started = w.tick;
      }
      if (ev.what === 'pattern') run.patterns.push(ev.value);
      if (ev.what === 'read') run.reads.push(ev.value);
      if (ev.what === 'plated') run.plated++;
      if (ev.what === 'interrupt') run.interrupts++;
      if (ev.what === 'defeated') return finish(run, w, started, true);
    }
  }
  return finish(run, w, started, false);
}

function finish(run: BossRun, w: { tick: number; players: { entity: number }[]; entities: { id: number; pl?: { maxHitFrac: number } }[] }, started: number, won: boolean): BossRun {
  run.won = won;
  run.seconds = (w.tick - Math.max(0, started)) / 60;
  const pe = w.entities.find((e) => e.id === w.players[0]!.entity);
  run.maxHitFrac = pe?.pl?.maxHitFrac ?? 0;
  return run;
}
