import { describe, expect, it } from 'vitest';
import { db } from '../unit/_db';
import { createWorld } from '../../src/core/sim/world';
import { step } from '../../src/core/sim/step';
import { applyCommand } from '../../src/core/sim/apply';
import { botInput, newMemory } from '../../src/core/bot/policies';
import { botUpkeep } from '../../src/core/bot/upkeep';
import { starterCharacter } from '../../src/core/loot/inventory';
import type { SimEvent } from '../../src/core/sim/types';

/**
 * The whole chapter from a fresh level-1 character: the gate to each zone in turn, the aspect
 * choice after the Iron Wood, the boss, the ending. The bot spends its points and wears its finds
 * at the citadel, at waystones and on level-ups, the way a player opens the menus.
 */
describe('the chapter, start to finish', () => {
  for (const [cls, aspect] of [
    ['berserker', 'human'],
    ['commando', 'cyber'],
  ] as const) {
    it(`${cls} (${aspect}) plays from the citadel to the ending`, () => {
      const d = db();
      const w = createWorld({ seed: 11, players: [{ name: 'Bot', cls, character: starterCharacter(d, 'Bot', cls) }], zone: 'citadel', node: 'hub' }, d);
      const mem = newMemory();
      let events: SimEvent[] = [];
      let deaths = 0;
      const log: string[] = [];
      for (const zone of ['ironwood', 'foundry', 'roots']) {
        botUpkeep(w, d, 0, aspect);
        expect(applyCommand(w, 0, { t: 'travel', zone, node: '' }, d), `travel ${zone}`).toBeNull();
        let t = 0;
        const start = deaths;
        // Into the zone, then until the zone sends the party home.
        for (; t < 60 * 60 * 40; t++) {
          step(w, { tick: w.tick, inputs: [botInput(w, d, 0, 'tactical', mem, events)] }, d);
          events = w.events;
          for (const ev of events) {
            if (ev.k === 'playerDown') deaths++;
            // At a waystone or a level-up, a player opens the menus: points, gear.
            if (ev.k === 'waystone' || ev.k === 'levelUp') botUpkeep(w, d, 0, aspect);
          }
          if (t > 10 && w.zone.id === 'citadel') break;
        }
        const c = w.players[0]!.character;
        const boss = w.entities.find((e) => e.boss);
        log.push(`${zone.padEnd(9)} ${(t / 3600).toFixed(1)} min, deaths ${deaths - start}, level ${c.level}, aspect ${c.alignment ?? '-'}, ended at ${w.zone.id}:${w.zone.node}${boss ? ` boss hp ${boss.hp}/${boss.hpMax} phase ${boss.boss!.phase}` : ''}`);
        process.stdout.write(`${cls} ${log[log.length - 1]}\n`);
        if (w.zone.id !== 'citadel') {
          const pe = w.entities.find((e) => e.kind === 'player')!;
          process.stdout.write(`  player ${pe.x.toFixed(1)},${pe.z.toFixed(1)} hp ${pe.hp}; room ${w.room.id} cleared=${w.room.cleared} enc=${w.room.encounters.map((x) => x.state + ':' + x.wave).join(',')} exits=${w.room.exits.map((x) => `${x.to}:${x.open}`).join(',')}\n`);
          for (const e of w.entities.filter((x) => x.kind === 'enemy' && !x.dead)) process.stdout.write(`  ${e.def} ${e.x.toFixed(1)},${e.z.toFixed(1)} hp ${e.hp} st=${e.ai?.st} tile=${w.room.tiles[Math.floor(e.z) * w.room.w + Math.floor(e.x)]}\n`);
        }
        expect(w.zone.id, `${zone} finished`).toBe('citadel');
      }
      const c = w.players[0]!.character;
      process.stdout.write(`\n${cls}:\n  ${log.join('\n  ')}\n`);
      expect(c.alignment).toBe(aspect);
      expect(c.story['zone.roots']).toBe(1);
      expect(c.story['chapter']).toBe(1);
      expect(c.story['beat:r.done']).toBe(1);
      expect(c.kills['hrungnir']).toBe(1);
    });
  }
});
