import { describe, expect, it } from 'vitest';
import { db } from '../_db';

describe('combat content', () => {
  const d = db();
  for (const w of Object.values(d.weapons)) {
    if (w.hand !== 'melee') continue;
    it(`${w.id}: every combo node is reachable from neutral and points at a valid action`, () => {
      const reached = new Set(['', '@air']);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of w.combo) if (!reached.has(n.id) && n.from.some((f) => reached.has(f))) {
          reached.add(n.id);
          grew = true;
        }
      }
      for (const n of w.combo) {
        expect(reached.has(n.id), `${w.id}.${n.id} unreachable`).toBe(true);
        expect(d.actions[n.action], `${w.id}.${n.id} -> ${n.action}`).toBeDefined();
        for (const f of n.from) expect(f === '' || f === '@air' || w.combo.some((m) => m.id === f), `${n.id} from ${f}`).toBe(true);
      }
    });
  }

  for (const a of Object.values(d.actions)) {
    it(`${a.id}: windows fall inside the action`, () => {
      expect(a.len).toBeGreaterThan(0);
      expect(a.cancel).toBeLessThanOrEqual(a.len);
      for (const h of a.hits) {
        expect(h.from).toBeGreaterThan(0);
        expect(h.to).toBeLessThanOrEqual(a.len);
        expect(h.from).toBeLessThanOrEqual(h.to);
        expect(h.cap).toBeLessThanOrEqual(0.45);
      }
      if (a.iframes) expect(a.iframes[1]).toBeLessThanOrEqual(a.len);
      if (a.shoot) for (const t of a.shoot.at) expect(t).toBeLessThan(a.len);
      if (a.shoot) expect(d.projectiles[a.shoot.proj]).toBeDefined();
    });
  }

  it('a hit allowed past 35% of max HP is telegraphed at least 900 ms ahead', () => {
    for (const a of Object.values(d.actions)) {
      for (const h of a.hits) {
        if (h.cap <= 0.35 || h.tag !== 'enemy') continue;
        expect(a.tele, a.id).not.toBeNull();
        expect(h.from, a.id).toBeGreaterThanOrEqual(54);
      }
    }
  });

  for (const b of Object.values(d.bosses)) {
    it(`boss ${b.id}: patterns resolve, blows are telegraphed at least 800 ms ahead, the script never triples`, () => {
      expect(d.enemies[b.id]).toBeDefined();
      if (b.guardian) expect(d.enemies[b.guardian]?.brain).toBe('guardian');
      const acts = new Set<string>();
      for (const p of b.patterns) for (const id of p.actions) acts.add(id);
      for (const at of d.enemies[b.guardian]?.attacks ?? []) acts.add(at.action);
      for (const id of acts) {
        const a = d.actions[id];
        expect(a, id).toBeDefined();
        if (!a!.hits.length) continue;
        expect(a!.tele, id).not.toBeNull();
        expect(a!.hits[0]!.from, id).toBeGreaterThanOrEqual(48);
      }
      for (const id of b.final) expect(id === 'overheat' || b.patterns.some((p) => p.id === id), id).toBe(true);
      for (let i = 0; i < b.final.length; i++) {
        const f = b.final;
        expect(f[i] === f[(i + 1) % f.length] && f[i] === f[(i + 2) % f.length]).toBe(false);
      }
      expect(b.phases.length + 1).toBe(3);
      for (const line of Object.values(b.lines)) expect(line.length).toBeGreaterThan(0);
    });
  }

  it('every class ability resolves to an action', () => {
    for (const c of Object.values(d.classes)) {
      for (const id of c.abilities) {
        expect(d.abilities[id], id).toBeDefined();
        expect(d.actions[d.abilities[id]!.action], id).toBeDefined();
      }
      expect(d.weapons[c.startMelee]?.hand).toBe('melee');
      expect(d.weapons[c.startRanged]?.hand).toBe('ranged');
    }
  });
});
