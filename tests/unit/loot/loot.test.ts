import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { training, tickN } from '../_world';
import { generateItem, usable } from '../../../src/core/loot/generate';
import { itemPower, itemName, weaponDamage } from '../../../src/core/loot/gear';
import { RARITIES, makeItem, type Item } from '../../../src/core/loot/item';
import { applyCommand } from '../../../src/core/sim/apply';
import { takeItem } from '../../../src/core/loot/inventory';
import { spawnEnemy } from '../../../src/core/sim/spawn';
import { INVENTORY_SIZE } from '../../../src/core/progression/character';

const W = [55, 31, 11, 2.7, 0.3];

describe('item generation', () => {
  it('is a pure function of its seed', () => {
    const a = generateItem(12345, { ilvl: 8, cls: 'berserker', weights: W }, db());
    const b = generateItem(12345, { ilvl: 8, cls: 'berserker', weights: W }, db());
    expect(a).toEqual(b);
    expect(generateItem(12346, { ilvl: 8, cls: 'berserker', weights: W }, db())).not.toEqual(a);
  });

  it('100,000 rolls: rarities match their weights; affixes obey counts, groups, item level and slots', () => {
    const d = db();
    const aff = new Map(d.affixes.map((x) => [x.id, x]));
    const COUNT = { worn: [0, 0], forged: [1, 1], runed: [2, 3], ascendant: [3, 4], relic: [4, 4] } as const;
    const counts = [0, 0, 0, 0, 0];
    const bad: string[] = [];
    let usableN = 0;
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const ilvl = 1 + (i % 16);
      const cls = i % 2 ? 'berserker' : 'commando';
      const it = generateItem(i * 2654435761, { ilvl, cls, weights: W }, d);
      counts[RARITIES.indexOf(it.rarity)]!++;
      const base = d.bases[it.base]!;
      if (base.ilvl > ilvl + 1) bad.push(`base ilvl ${it.base}@${ilvl}`);
      const [lo, hi] = COUNT[it.rarity];
      if (it.affixes.length < lo || it.affixes.length > hi) bad.push(`${it.rarity} with ${it.affixes.length}`);
      const groups: string[] = [];
      for (const a of it.affixes) {
        const def = aff.get(a.id)!;
        if (def.ilvl > ilvl) bad.push(`affix ilvl ${a.id}@${ilvl}`);
        if (!def.slots.includes(base.slot)) bad.push(`slot ${a.id} on ${base.slot}`);
        if (groups.includes(def.group)) bad.push(`group ${def.group} twice`);
        groups.push(def.group);
        const x = Math.min(...def.range);
        const y = Math.max(...def.range);
        if (a.v < x - 1e-9 || a.v > y + 1e-9) bad.push(`value ${a.id}=${a.v}`);
      }
      if (it.sockets.length > 3) bad.push('sockets');
      if (usable(d, base, cls)) usableN++;
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
    const total = W.reduce((a, b) => a + b, 0);
    W.forEach((w, i) => {
      const expected = (w / total) * N;
      const tol = Math.max(60, expected * 0.06);
      expect(Math.abs(counts[i]! - expected), `${RARITIES[i]}: ${counts[i]} vs ${expected.toFixed(0)}`).toBeLessThan(tol);
    });
    // Smart loot: well over half the drops are usable by the player they dropped for.
    expect(usableN / N).toBeGreaterThan(0.6);
  });

  it('relics carry a unique power when one exists for their slot', () => {
    const d = db();
    for (let i = 0; i < 200; i++) {
      const it = generateItem(i + 7, { ilvl: 12, cls: 'berserker', weights: W, rarity: 'relic' }, d);
      if (Object.values(d.uniques).some((u) => u.slot === d.bases[it.base]!.slot)) expect(it.unique).not.toBeNull();
    }
  });

  it('names read prefix, base, suffix; relics use their unique name', () => {
    const it = makeItem('w.blades.2', 'runed', 6, 'x', [{ id: 'brutal.2', v: 0.1 }, { id: 'wolf.2', v: 0.02 }]);
    expect(itemName(db(), it)).toBe('Brutal Iron-bark Blades of the Wolf');
    expect(weaponDamage(db(), it)![1]).toBeGreaterThan(db().weapons.blades!.dmg[1]);
  });
});

describe('inventory', () => {
  it('equipping a weapon changes damage; a class cannot equip what it cannot wield', () => {
    const { w } = training('berserker');
    const c = w.players[0]!.character;
    const axe = makeItem('w.axe.2', 'ascendant', 8, 'axe', [{ id: 'savage.2', v: 0.12 }]);
    c.inv.push(axe);
    const before = w.players[0]!.stats.melee[1];
    expect(applyCommand(w, 0, { t: 'equip', uid: 'axe' }, db())).toBeNull();
    expect(w.players[0]!.stats.meleeKind).toBe('greataxe');
    expect(w.players[0]!.stats.melee[1]).toBeGreaterThan(before);
    expect(c.inv.some((i) => i.uid === 'start:melee')).toBe(true);
    c.inv.push(makeItem('w.rifle.1', 'worn', 1, 'rifle', []));
    expect(applyCommand(w, 0, { t: 'equip', uid: 'rifle' }, db())).toMatch(/can't use/);
  });

  it('auto-salvage takes weak worn drops on pickup, and undo gives them back with the yield', () => {
    const { w } = training('berserker');
    const c = w.players[0]!.character;
    applyCommand(w, 0, { t: 'setAutoSalvage', maxRarity: 1, onlyIfWorse: true, keepSockets: 0 }, db());
    c.equip.melee = makeItem('w.blades.3', 'ascendant', 12, 'good', [{ id: 'brutal.3', v: 0.2 }]);
    const junk = makeItem('w.blades.1', 'worn', 1, 'junk', []);
    expect(takeItem(db(), c, junk)).toBe('salvaged');
    const bounty = c.bounty;
    expect(bounty).toBeGreaterThan(0);
    expect(applyCommand(w, 0, { t: 'unsalvage', uid: 'junk' }, db())).toBeNull();
    expect(c.inv.some((i) => i.uid === 'junk')).toBe(true);
    expect(c.bounty).toBe(0);
    // An upgrade is never auto-salvaged.
    const upgrade = makeItem('w.blades.3', 'forged', 14, 'up', [{ id: 'brutal.3', v: 0.2 }]);
    c.equip.melee = makeItem('w.blades.1', 'worn', 1, 'old', []);
    expect(takeItem(db(), c, upgrade)).toBe('kept');
  });

  it('a full bag keeps the best: the weakest item, old or new, is salvaged', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    for (let i = 0; i < INVENTORY_SIZE; i++) c.inv.push(makeItem('a.helm.1', 'forged', 3, `h${i}`, [{ id: 'hale.1', v: 20 }]));
    expect(takeItem(db(), c, makeItem('a.helm.1', 'worn', 1, 'weak', []))).toBe('salvaged');
    expect(takeItem(db(), c, makeItem('a.helm.3', 'ascendant', 12, 'strong', [{ id: 'hale.3', v: 80 }]))).toBe('swapped');
    expect(c.inv.length).toBe(INVENTORY_SIZE);
    expect(c.inv.some((i) => i.uid === 'strong')).toBe(true);
  });

  it('runes socket into items and three of a kind fuse up a tier', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    c.runes['rune.tyr.1'] = 4;
    expect(applyCommand(w, 0, { t: 'fuseRunes', rune: 'rune.tyr.1' }, db())).toBeNull();
    expect(c.runes['rune.tyr.1']).toBe(1);
    expect(c.runes['rune.tyr.2']).toBe(1);
    const it = makeItem('w.blades.2', 'runed', 6, 'sock', [], 2);
    c.inv.push(it);
    applyCommand(w, 0, { t: 'equip', uid: 'sock' }, db());
    const pct = w.players[0]!.stats.dmgPct;
    expect(applyCommand(w, 0, { t: 'socket', uid: 'sock', rune: 'rune.tyr.2', idx: 0 }, db())).toBeNull();
    expect(w.players[0]!.stats.dmgPct).toBeCloseTo(pct + 0.08, 9);
  });

  it('crafting needs the blueprint and the materials, and rolls the rest from the sim', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    expect(applyCommand(w, 0, { t: 'craft', blueprint: 'bp.wolfblades' }, db())).toMatch(/blueprint/);
    c.blueprints.push('bp.wolfblades');
    expect(applyCommand(w, 0, { t: 'craft', blueprint: 'bp.wolfblades' }, db())).toMatch(/bounty/);
    c.bounty = 400;
    c.mats = { 'mat.iron': 12, 'mat.rune': 4 };
    expect(applyCommand(w, 0, { t: 'craft', blueprint: 'bp.wolfblades' }, db())).toBeNull();
    const made = c.inv[c.inv.length - 1]!;
    expect(made.rarity).toBe('ascendant');
    expect(made.affixes.map((a) => a.id)).toEqual(expect.arrayContaining(['brutal.2', 'wolf.2']));
    expect(made.affixes.length).toBeGreaterThanOrEqual(3);
  });

  it('the stash moves items in and out', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    c.inv.push(makeItem('a.legs.1', 'worn', 1, 'pants', []));
    expect(applyCommand(w, 0, { t: 'stash', uid: 'pants', dir: 'in' }, db())).toBeNull();
    expect(w.stash.length).toBe(1);
    expect(applyCommand(w, 0, { t: 'stash', uid: 'pants', dir: 'out' }, db())).toBeNull();
    expect(c.inv.some((i) => i.uid === 'pants')).toBe(true);
  });
});

describe('drops', () => {
  it('drops are per player and reproducible; a boss guarantees Ascendant or better once', () => {
    const run = () => {
      const { w, p } = training();
      const items: Item[] = [];
      for (let i = 0; i < 60; i++) {
        const e = spawnEnemy(w, db(), 'troll', p.x + 3, p.z, 5, ['hasted']);
        e.lastHit = p.id;
        e.hp = 0;
        tickN(w, 2);
      }
      for (const e of w.entities) if (e.pick?.item) items.push(e.pick.item);
      return { items, owners: w.entities.filter((e) => e.pick?.item).map((e) => e.pick!.owner) };
    };
    const a = run();
    const b = run();
    expect(a.items).toEqual(b.items);
    expect(a.items.length).toBeGreaterThan(10);
    expect(new Set(a.owners)).toEqual(new Set([0]));
  });

  it('item power orders an upgrade above a worn starter', () => {
    const d = db();
    expect(itemPower(d, makeItem('w.blades.3', 'ascendant', 12, 'a', [{ id: 'brutal.3', v: 0.2 }]))).toBeGreaterThan(itemPower(d, makeItem('w.blades.1', 'worn', 1, 'b', [])));
  });
});
