import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import type { Alignment } from '../progression/character';
import { applyCommand } from '../sim/apply';
import { allocFor, budgetFor, canRank, treeFor } from '../progression/skills';
import { itemPower } from '../loot/gear';
import { usable } from '../loot/generate';
import { rarityIndex } from '../loot/item';

/**
 * What a player does in the menus between fights, for the bot: take the aspect when it is
 * offered, spend skill points down the tree in order, and wear the strongest item found for each
 * slot. Everything goes through commands, exactly as the menus send them.
 */
export function botUpkeep(w: World, db: ContentDb, slot: number, aspect: Alignment): void {
  const p = w.players[slot];
  if (!p) return;
  const c = p.character;
  if (!c.alignment && c.story['align.offer']) applyCommand(w, slot, { t: 'chooseAlignment', a: aspect }, db);
  for (const tree of ['cls', ...(c.alignment ? [c.alignment] : [])] as const) {
    const t = treeFor(db, c, tree);
    for (let guard = 0; guard < 80; guard++) {
      const node = t.nodes.find((n) => !canRank(t, allocFor(c, tree), n, budgetFor(c, tree), c.cls));
      if (!node || applyCommand(w, slot, { t: 'allocSkill', node: node.id, tree }, db)) break;
    }
  }
  // The smithy: craft a known blueprint when it beats what that slot holds and it is affordable.
  for (const id of c.blueprints) {
    const bp = db.blueprints[id];
    const base = bp ? db.bases[bp.base] : null;
    if (!bp || !base || !usable(db, base, c.cls)) continue;
    const cur = c.equip[base.slot as keyof typeof c.equip];
    if (cur && rarityIndex(cur.rarity) >= rarityIndex(bp.rarity) && cur.ilvl >= base.ilvl) continue;
    applyCommand(w, slot, { t: 'craft', blueprint: id }, db);
  }
  const tried: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    let best: { uid: string; gain: number } | null = null;
    for (const it of c.inv) {
      const base = db.bases[it.base];
      if (!base || base.slot === 'charm' || tried.includes(it.uid)) continue;
      const cur = c.equip[base.slot as keyof typeof c.equip];
      const gain = itemPower(db, it) - (cur ? itemPower(db, cur) : 0);
      if (gain > 0 && (!best || gain > best.gain)) best = { uid: it.uid, gain };
    }
    if (!best) break;
    // A refused item (another class's weapon) is skipped, not retried.
    if (applyCommand(w, slot, { t: 'equip', uid: best.uid }, db)) tried.push(best.uid);
  }
}
