import type { ContentDb } from '../data/types';
import { createWorld, playerEntity } from '../sim/world';
import { step } from '../sim/step';
import { spawnEnemy } from '../sim/spawn';
import { botInput, newMemory, type Policy } from './policies';
import { newCharacter } from '../progression/character';
import type { SimEvent } from '../sim/types';

export interface FightSpec {
  seed: number;
  cls: string;
  level: number;
  enemies: string[];
  enemyLevel: number;
  policy: Policy;
  elites?: string[];
  maxTicks?: number;
  /** Skill picks to apply before the fight (node ids), for realistic builds. */
  skills?: string[];
}

export interface FightResult {
  won: boolean;
  ticks: number;
  deaths: number;
  dmgTaken: number;
  maxHitFrac: number;
}

/** One seeded fight in the arena: the bot against a fixed group, until one side is gone. */
export function runFight(db: ContentDb, f: FightSpec): FightResult {
  const character = newCharacter('Bot', f.cls);
  character.level = f.level;
  character.xp = 0;
  for (const s of f.skills ?? []) character.skills.cls[s] = (character.skills.cls[s] ?? 0) + 1;
  const w = createWorld({ seed: f.seed, players: [{ name: 'Bot', cls: f.cls, character }], zone: 'training', node: 'arena' }, db);
  // Arena encounters stay asleep; the fight is just these enemies.
  for (const enc of w.room.encounters) enc.state = 'done';
  const p = playerEntity(w, 0)!;
  f.enemies.forEach((id, i) => {
    const e = spawnEnemy(w, db, id, p.x + (i % 2 ? 6 : -6) + i * 0.3, p.z - 6 - (i % 3), f.enemyLevel, i === 0 ? (f.elites ?? []) : []);
    e.ai!.aggro = true;
  });
  const mem = newMemory();
  let events: SimEvent[] = [];
  let deaths = 0;
  const max = f.maxTicks ?? 60 * 240;
  for (let t = 0; t < max; t++) {
    const inp = botInput(w, db, 0, f.policy, mem, events);
    step(w, { tick: w.tick, inputs: [inp] }, db);
    events = w.events;
    for (const ev of events) if (ev.k === 'playerDown') deaths++;
    if (!w.entities.some((e) => e.kind === 'enemy' && !e.dead)) {
      return { won: deaths === 0, ticks: t, deaths, dmgTaken: p.pl!.dmgTaken, maxHitFrac: p.pl!.maxHitFrac };
    }
    // Three deaths ends it: the fight is lost.
    if (deaths >= 3) break;
  }
  return { won: false, ticks: max, deaths, dmgTaken: p.pl!.dmgTaken, maxHitFrac: p.pl!.maxHitFrac };
}
