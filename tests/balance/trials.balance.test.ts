import { describe, expect, it } from 'vitest';
import { db } from '../unit/_db';
import { preparedCharacter } from './_run';
import { createWorld } from '../../src/core/sim/world';
import { step } from '../../src/core/sim/step';
import { applyCommand } from '../../src/core/sim/apply';
import { botInput, newMemory } from '../../src/core/bot/policies';
import { trialMods } from '../../src/core/level/trials';
import type { SimEvent } from '../../src/core/sim/types';

function runTrial(cls: string, level: number, zone: string, tier: number): { done: boolean; deaths: number; minutes: number } {
  const d = db();
  const c = preparedCharacter(cls, level, cls === 'berserker' ? 'cyber' : 'human');
  // A character who has finished the chapter: every zone open.
  Object.assign(c.story, { chapter: 1, alignment: 1, 'zone.foundry': 1, 'zone.roots': 1 });
  c.story[`trial:${zone}`] = tier - 1;
  const w = createWorld({ seed: 31 + tier, players: [{ name: 'Bot', cls, character: c }], zone: 'citadel', node: 'hub' }, d);
  expect(applyCommand(w, 0, { t: 'travel', zone, node: '', trial: tier, mods: trialMods(d, w.players[0]!.character, zone, tier) }, d)).toBeNull();
  const mem = newMemory();
  let events: SimEvent[] = [];
  let deaths = 0;
  let t = 0;
  for (; t < 60 * 60 * 25; t++) {
    step(w, { tick: w.tick, inputs: [botInput(w, d, 0, 'tactical', mem, events)] }, d);
    events = w.events;
    for (const ev of events) if (ev.k === 'playerDown') deaths++;
    if (t > 10 && w.zone.id === 'citadel') break;
  }
  return { done: w.zone.id === 'citadel' && (w.players[0]!.character.story[`trial:${zone}`] ?? 0) >= tier, deaths, minutes: t / 3600 };
}

/** The endgame is reachable: a character at the cap clears the first tiers of every zone. */
describe('Wyrd Trials', () => {
  const report: string[] = [];
  for (const zone of ['ironwood', 'foundry', 'roots']) {
    it(`${zone}: tier 1 at level 16, tier 3 at the cap`, () => {
      const a = runTrial('berserker', 16, zone, 1);
      const b = runTrial('commando', 20, zone, 3);
      report.push(`${zone.padEnd(9)} t1 L16 berserker ${a.done ? 'cleared' : 'FAILED'} ${a.minutes.toFixed(1)}m deaths ${a.deaths}; t3 L20 commando ${b.done ? 'cleared' : 'FAILED'} ${b.minutes.toFixed(1)}m deaths ${b.deaths}`);
      expect(a.done).toBe(true);
      expect(b.done).toBe(true);
    });
  }
  it('report', () => process.stdout.write('\n' + report.join('\n') + '\n'));
});
