import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import { HOW_AIR, HOW_BEHIND, HOW_RANGED, HOW_STATUS, HOW_WEAK } from '../combat/hits';
import { byId } from '../sim/entity';
import { makeItem } from '../loot/item';

const HOW: Record<string, number> = { killAir: HOW_AIR, killBehind: HOW_BEHIND, killStatus: HOW_STATUS, killWeak: HOW_WEAK, killRanged: HOW_RANGED };

/**
 * Charm quests teach tactics: "kill bulwarks from behind", "kill while airborne". Progress counts
 * only kills the questing player landed, the way the quest asks.
 */
export function charmProgress(w: World, db: ContentDb, dead: Entity): void {
  const killer = byId(w, dead.lastHit);
  if (!killer?.pl) return;
  const p = w.players[killer.pl.slot]!;
  for (const q of p.character.charms) {
    if (q.done) continue;
    const def = db.charms[q.id];
    if (!def) continue;
    def.quests.forEach((step, i) => {
      if ((q.progress[i] ?? 0) >= step.count) return;
      if (step.target !== '*' && step.target !== dead.def) return;
      if (step.kind !== 'kill' && !(dead.lastHow & HOW[step.kind]!)) return;
      q.progress[i] = (q.progress[i] ?? 0) + 1;
    });
    if (def.quests.every((s, i) => (q.progress[i] ?? 0) >= s.count)) {
      q.done = true;
      const base = Object.values(db.bases).find((b) => b.slot === 'charm' && b.ruiner === def.ruiner);
      if (base && p.character.inv.length < 40) p.character.inv.push(makeItem(base.id, 'runed', p.character.level, `charm:${q.id}`, []));
      w.events.push({ k: 'quest', t: w.tick, slot: p.slot, charm: q.id, done: true });
    }
  }
}

export function takeQuest(w: World, slot: number, charm: string, db: ContentDb): string | null {
  const c = w.players[slot]!.character;
  if (!db.charms[charm]) return 'Unknown charm';
  if (c.charms.some((q) => q.id === charm)) return 'Already taken';
  if (c.charms.filter((q) => !q.done).length >= 3) return 'Three quests at a time';
  c.charms.push({ id: charm, progress: db.charms[charm]!.quests.map(() => 0), done: false });
  return null;
}
