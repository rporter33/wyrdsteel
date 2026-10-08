import type { ContentDb } from '../data/types';
import type { Entity, World } from './types';
import { TEAM_ENEMIES } from './types';
import { newEntity } from './entity';
import { difficultyHp } from '../combat/hits';

export function spawnEnemy(w: World, db: ContentDb, defId: string, x: number, z: number, level: number, elites: string[]): Entity {
  const def = db.enemies[defId];
  if (!def) throw new Error(`unknown enemy ${defId}`);
  const e = newEntity(w, 'enemy', defId, TEAM_ENEMIES, x, z);
  e.level = level;
  e.r = def.radius;
  e.h = def.height;
  let hp = (def.hp + def.hpPerLevel * (level - 1)) * difficultyHp(w);
  for (const el of elites) hp *= db.elites[el]?.hpMult ?? 1;
  e.hpMax = Math.max(1, Math.round(hp));
  e.hp = e.hpMax;
  e.poiseMax = def.poise;
  e.poise = def.poise;
  e.elite = elites.length ? [...elites] : undefined;
  e.fz = 1;
  e.fx = 0;
  if (def.parts.length) e.parts = def.parts.map((p) => ({ id: p.id, hp: Math.round(p.hp * (1 + 0.1 * (level - 1))), hpMax: Math.round(p.hp * (1 + 0.1 * (level - 1))), broken: false }));
  e.ai = { st: 'idle', t: 0, target: 0, token: 0, cds: def.attacks.map((a) => a.cd >> 1), gcd: 30, homeX: x, homeZ: z, aggro: false, a: 0, b: 0, c: 0, enc: -1, link: 0, side: e.id % 2 === 0 ? 1 : -1 };
  return e;
}
