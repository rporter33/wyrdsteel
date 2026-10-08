import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import { byId } from '../sim/entity';
import { computeStats } from './stats';

/** Cumulative XP needed to reach each level (index = level). Chapter one caps at 20. */
export const XP_TABLE = [0, 0, 100, 260, 480, 760, 1100, 1520, 2020, 2600, 3260, 4000, 4840, 5780, 6820, 7960, 9200, 10560, 12040, 13640, 15360];
export const LEVEL_CAP = 20;

export function levelFor(xp: number): number {
  let l = 1;
  while (l < LEVEL_CAP && xp >= XP_TABLE[l + 1]!) l++;
  return l;
}

/** Give XP to every player in the world; level-ups refresh stats and refill health. */
export function grantXp(w: World, db: ContentDb, amount: number): void {
  for (const p of w.players) {
    const c = p.character;
    c.xp += Math.round(amount * (1 + p.stats.xpPct));
    const lvl = levelFor(c.xp);
    if (lvl > c.level) {
      c.level = lvl;
      refreshPlayer(w, db, p.slot, true);
      w.events.push({ k: 'levelUp', t: w.tick, slot: p.slot, level: lvl });
    }
  }
}

/** Recompute derived stats after a change; keep the HP fraction (or refill on level-up). */
export function refreshPlayer(w: World, db: ContentDb, slot: number, refill = false): void {
  const p = w.players[slot]!;
  const e = byId(w, p.entity);
  const frac = e ? e.hp / Math.max(1, e.hpMax) : 1;
  p.stats = computeStats(p.character, db);
  if (e) {
    e.level = p.character.level;
    e.hpMax = p.stats.hpMax;
    e.hp = refill ? e.hpMax : Math.max(1, Math.round(e.hpMax * frac));
  }
}

export function xpFor(db: ContentDb, def: string, level: number, elite: boolean): number {
  const d = db.enemies[def];
  if (!d) return 0;
  return Math.round(d.xp * (1 + 0.15 * (level - 1)) * (elite ? 2.5 : 1));
}
