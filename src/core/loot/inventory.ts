import type { ContentDb } from '../data/types';
import type { Entity, World } from '../sim/types';
import type { Command } from '../sim/commands';
import { newCharacter, INVENTORY_SIZE, type CharacterState } from '../progression/character';
import { makeItem, rarityIndex, type GearSlot, type Item } from './item';
import { itemPower } from './gear';
import { salvage, unsalvage } from './salvage';
import { usable, generateItem } from './generate';
import { refreshPlayer } from '../progression/rewards';
import { mix } from '../rng/xoshiro';

/** A fresh character holding worn versions of their class's starting weapons. */
export function starterCharacter(db: ContentDb, name: string, cls: string): CharacterState {
  const c = newCharacter(name, cls);
  const def = db.classes[cls];
  if (def) {
    const melee = Object.values(db.bases).find((b) => b.slot === 'melee' && b.kind === def.startMelee && b.ilvl === 1);
    const ranged = Object.values(db.bases).find((b) => b.slot === 'ranged' && b.kind === def.startRanged && b.ilvl === 1);
    if (melee) c.equip.melee = makeItem(melee.id, 'worn', 1, 'start:melee', []);
    if (ranged) c.equip.ranged = makeItem(ranged.id, 'worn', 1, 'start:ranged', []);
  }
  return c;
}

function equippedPower(db: ContentDb, c: CharacterState, slot: GearSlot): number {
  const it = c.equip[slot];
  return it ? itemPower(db, it) : -1;
}

/** Should the auto-salvage filter take this item on pickup? */
export function autoSalvages(db: ContentDb, c: CharacterState, it: Item): boolean {
  const rule = c.autoSalvage;
  if (rule.maxRarity < 0 || it.unique) return false;
  if (rarityIndex(it.rarity) > rule.maxRarity) return false;
  if (rule.keepSockets > 0 && it.sockets.length >= rule.keepSockets) return false;
  const slot = db.bases[it.base]!.slot;
  if (rule.onlyIfWorse && itemPower(db, it) >= equippedPower(db, c, slot)) return false;
  return true;
}

/**
 * Picking up an item: the filters run first; on a full bag the weakest item (new or old) is
 * salvaged instead, so the bag never blocks a pickup. Everything salvaged can be undone.
 */
export function takeItem(db: ContentDb, c: CharacterState, it: Item): 'kept' | 'salvaged' | 'swapped' {
  if (autoSalvages(db, c, it)) {
    salvage(c, it);
    return 'salvaged';
  }
  if (c.inv.length < INVENTORY_SIZE) {
    c.inv.push(it);
    return 'kept';
  }
  let weakest = 0;
  for (let i = 1; i < c.inv.length; i++) if (itemPower(db, c.inv[i]!) < itemPower(db, c.inv[weakest]!)) weakest = i;
  if (itemPower(db, it) > itemPower(db, c.inv[weakest]!)) {
    salvage(c, c.inv.splice(weakest, 1)[0]!);
    c.inv.push(it);
    return 'swapped';
  }
  salvage(c, it);
  return 'salvaged';
}

export function pickupItem(w: World, db: ContentDb, slot: number, it: Entity): void {
  const c = w.players[slot]!.character;
  const pk = it.pick!;
  if (pk.kind === 'item' && pk.item) {
    const r = takeItem(db, c, pk.item);
    if (r !== 'kept') w.events.push({ k: 'pickup', t: w.tick, slot, kind: 'salvaged', ref: pk.item.uid, amount: 0, rarity: pk.item.rarity });
  } else if (pk.kind === 'rune') c.runes[pk.ref] = (c.runes[pk.ref] ?? 0) + 1;
  else if (pk.kind === 'mat') c.mats[pk.ref] = (c.mats[pk.ref] ?? 0) + pk.amount;
}

function findInv(c: CharacterState, uid: string): number {
  return c.inv.findIndex((i) => i.uid === uid);
}

/** Item commands: equip, salvage and undo, sockets and runes, crafting, the stash, filters. */
export function applyItemCommand(w: World, slot: number, cmd: Command, db: ContentDb): string | null {
  const p = w.players[slot]!;
  const c = p.character;
  switch (cmd.t) {
    case 'equip': {
      const i = findInv(c, cmd.uid);
      if (i < 0) return 'Not in your bag';
      const it = c.inv[i]!;
      const base = db.bases[it.base]!;
      if (!usable(db, base, c.cls)) return `${db.classes[c.cls]?.name ?? c.cls}s can't use ${db.weapons[base.kind]?.name ?? base.kind}`;
      const prev = c.equip[base.slot];
      c.inv.splice(i, 1);
      if (prev) c.inv.splice(i, 0, prev);
      c.equip[base.slot] = it;
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'unequip': {
      const s = cmd.slot as GearSlot;
      const it = c.equip[s];
      if (!it) return 'Nothing equipped';
      if (s === 'melee' || s === 'ranged') return 'A weapon must stay equipped';
      if (c.inv.length >= INVENTORY_SIZE) return 'Inventory full';
      c.equip[s] = null;
      c.inv.push(it);
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'salvage': {
      for (const uid of cmd.uids) {
        const i = findInv(c, uid);
        if (i >= 0) salvage(c, c.inv.splice(i, 1)[0]!);
      }
      return null;
    }
    case 'unsalvage':
      return unsalvage(c, cmd.uid);
    case 'setAutoSalvage':
      c.autoSalvage = { maxRarity: cmd.maxRarity, onlyIfWorse: cmd.onlyIfWorse, keepSockets: cmd.keepSockets };
      return null;
    case 'socket': {
      const it = c.inv.find((x) => x.uid === cmd.uid) ?? Object.values(c.equip).find((x) => x?.uid === cmd.uid) ?? null;
      if (!it) return 'No such item';
      if (cmd.idx < 0 || cmd.idx >= it.sockets.length) return 'No such socket';
      if ((c.runes[cmd.rune] ?? 0) < 1) return 'You have no such rune';
      // The rune already there is destroyed: carving is permanent.
      c.runes[cmd.rune]!--;
      it.sockets[cmd.idx] = cmd.rune;
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'fuseRunes': {
      const r = db.runes[cmd.rune];
      if (!r) return 'Unknown rune';
      const next = cmd.rune.replace(/\.(\d)$/, (_m, d) => `.${Number(d) + 1}`);
      if (!db.runes[next]) return 'Already the highest tier';
      if ((c.runes[cmd.rune] ?? 0) < 3) return 'Needs three of a kind';
      c.runes[cmd.rune]! -= 3;
      c.runes[next] = (c.runes[next] ?? 0) + 1;
      return null;
    }
    case 'addSocket': {
      const it = c.inv.find((x) => x.uid === cmd.uid) ?? Object.values(c.equip).find((x) => x?.uid === cmd.uid) ?? null;
      if (!it) return 'No such item';
      const base = db.bases[it.base]!;
      if (!['melee', 'ranged', 'chest', 'helm'].includes(base.slot)) return 'This item cannot hold runes';
      if (it.sockets.length >= 3) return 'Already three sockets';
      const cost = 80 * (it.sockets.length + 1) * (1 + Math.floor(it.ilvl / 5));
      if (c.bounty < cost) return `Needs ${cost} bounty`;
      c.bounty -= cost;
      it.sockets.push(null);
      return null;
    }
    case 'craft': {
      const bp = db.blueprints[cmd.blueprint];
      if (!bp) return 'Unknown blueprint';
      if (!c.blueprints.includes(bp.id)) return "You don't know that blueprint";
      if (c.bounty < bp.bounty) return `Needs ${bp.bounty} bounty`;
      for (const [k, n] of Object.entries(bp.mats)) if ((c.mats[k] ?? 0) < n) return `Needs ${n} ${k.replace('mat.', '')}`;
      if (c.inv.length >= INVENTORY_SIZE) return 'Inventory full';
      c.bounty -= bp.bounty;
      for (const [k, n] of Object.entries(bp.mats)) c.mats[k] = c.mats[k]! - n;
      // The remaining affixes roll from the sim's loot stream, so a craft replays identically.
      const seed = mix(w.seed, w.tick, slot, c.inv.length, 0xc4af7);
      const ilvl = Math.max(db.bases[bp.base]!.ilvl, c.level);
      c.inv.push(generateItem(seed, { ilvl, cls: c.cls, weights: [1, 1, 1, 1, 1], base: bp.base, rarity: bp.rarity, guaranteed: bp.guaranteed }, db));
      return null;
    }
    case 'stash': {
      if (cmd.dir === 'in') {
        const i = findInv(c, cmd.uid);
        if (i < 0) return 'Not in your bag';
        if (w.stash.length >= 60) return 'Stash full';
        w.stash.push(c.inv.splice(i, 1)[0]!);
      } else {
        const i = w.stash.findIndex((x) => x.uid === cmd.uid);
        if (i < 0) return 'Not in the stash';
        if (c.inv.length >= INVENTORY_SIZE) return 'Inventory full';
        c.inv.push(w.stash.splice(i, 1)[0]!);
      }
      return null;
    }
    case 'setCharm': {
      const i = findInv(c, cmd.charm);
      if (i < 0) return 'Not in your bag';
      return applyItemCommand(w, slot, { t: 'equip', uid: cmd.charm }, db);
    }
  }
  return `Unsupported: ${cmd.t}`;
}
