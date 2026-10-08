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
