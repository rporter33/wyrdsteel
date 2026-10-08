import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import { byId, newEntity } from '../sim/entity';
import { TEAM_NEUTRAL } from '../sim/types';
import { grantXp, xpFor } from './rewards';
import { nextFloat } from '../rng/xoshiro';
import { spawnShot } from '../combat/projectiles';
import { dropLoot } from '../loot/drop';

export function spawnPickup(w: World, kind: 'bounty' | 'heal' | 'shade' | 'item' | 'rune' | 'mat', x: number, z: number, amount: number, ref = '', owner = -1): Entity {
  const p = newEntity(w, 'pickup', kind, TEAM_NEUTRAL, x, z);
  p.r = 0.3;
  p.h = 0.5;
  p.pick = { kind, owner, ref, amount, item: null };
  // A small hop so drops scatter visibly.
  const a = nextFloat(w.rng.combat) * 6.283;
  p.vx = (a < 3.14 ? 1 : -1) * (0.6 + nextFloat(w.rng.combat) * 1.2);
  p.vz = (a % 2 < 1 ? 1 : -1) * (0.6 + nextFloat(w.rng.combat) * 1.2);
  p.vy = 4;
  p.y = 0.1;
  return p;
}

/** XP to everyone, bounty and the odd healing orb on the floor, item rolls per player, elite effects. */
export function onEnemyDeath(w: World, db: ContentDb, id: number): void {
  const e = byId(w, id);
  if (!e || e.kind !== 'enemy') return;
  const def = db.enemies[e.def];
  if (!def || def.brain === 'dummy') return;
  const elite = !!e.elite?.length;
  grantXp(w, db, xpFor(db, e.def, e.level, elite));
  const bounty = Math.round(def.bounty * (1 + 0.1 * (e.level - 1)) * (elite ? 3 : 1));
  if (bounty > 0) spawnPickup(w, 'bounty', e.x, e.z, bounty);
  if (nextFloat(w.rng.combat) < (elite ? 0.6 : 0.1)) spawnPickup(w, 'heal', e.x, e.z, 0.12);
  dropLoot(w, db, e, elite);
  for (const p of w.players) {
    const c = p.character;
    c.kills[e.def] = (c.kills[e.def] ?? 0) + 1;
  }
  // Ruin for the killer.
  const killer = byId(w, e.lastHit);
  if (killer?.pl) killer.pl.ruin = Math.min(100, killer.pl.ruin + 6 * w.players[killer.pl.slot]!.stats.ruinGain);
  if (e.elite?.includes('volatile')) {
    spawnShot(w, db, { owner: e, def: 'volatile.blast', x: e.x, z: e.z, y: 0.5, dx: 0, dz: 1, mult: 1.6 });
    w.events.push({ k: 'telegraph', t: w.tick, src: e.id, shape: 'circle', x: e.x, z: e.z, r: 3, dx: 0, dz: 1, len: 3, width: 0, dur: db.projectiles['volatile.blast']!.life });
  }
  if (e.ai?.link) {
    const partner = byId(w, e.ai.link);
    if (partner && !partner.dead) partner.hp = 0;
  }
}
