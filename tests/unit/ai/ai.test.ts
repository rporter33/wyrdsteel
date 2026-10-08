import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { tickN, press } from '../_world';
import { createWorld, playerEntity } from '../../../src/core/sim/world';
import { spawnEnemy } from '../../../src/core/sim/spawn';
import { tokenCap, TOKEN_MELEE, holders } from '../../../src/core/ai/director';
import { BTN } from '../../../src/core/input/frame';
import type { Entity, World } from '../../../src/core/sim/types';

function arena(seed = 3): { w: World; p: Entity } {
  const w = createWorld({ seed, players: [{ name: 'A', cls: 'berserker' }], zone: 'training', node: 'arena' }, db());
  return { w, p: playerEntity(w, 0)! };
}

function ring(w: World, p: Entity, def: string, n: number, r = 4): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const e = spawnEnemy(w, db(), def, p.x + (i % 2 ? r : -r) + (i % 3) * 0.4, p.z + (i % 4) - 1.5, 3, []);
    e.ai!.aggro = true;
    out.push(e);
  }
  return out;
}

describe('attack director', () => {
  it('never lets more than the cap of melee enemies attack one player at once', () => {
    const { w, p } = arena();
    p.hp = p.hpMax = 1e9;
    ring(w, p, 'thrall', 10);
    let maxSeen = 0;
    let attacked = 0;
    for (let t = 0; t < 900; t++) {
      tickN(w, 1);
      const n = holders(w, p.id, TOKEN_MELEE);
      maxSeen = Math.max(maxSeen, n);
      const swinging = w.entities.filter((e) => e.kind === 'enemy' && e.act && e.ai?.target === p.id).length;
      expect(swinging).toBeLessThanOrEqual(tokenCap(w, TOKEN_MELEE));
      if (swinging) attacked++;
    }
    expect(maxSeen).toBe(tokenCap(w, TOKEN_MELEE));
    expect(attacked).toBeGreaterThan(100);
  });

  it('waiting thralls spread around the target instead of stacking', () => {
    const { w, p } = arena();
    p.hp = p.hpMax = 1e9;
    const ts = ring(w, p, 'thrall', 8);
    tickN(w, 240);
    const angles = new Set(ts.filter((t) => !t.dead).map((t) => Math.round(Math.atan2(t.x - p.x, t.z - p.z) / (Math.PI / 4))));
    expect(angles.size).toBeGreaterThanOrEqual(4);
  });
});

describe('telegraphs', () => {
  it('every enemy attack warns at least 350 ms (fodder) or 600 ms (heavies) before it can land', () => {
    const d = db();
    for (const e of Object.values(d.enemies)) {
      for (const a of e.attacks) {
        const act = d.actions[a.action]!;
        const first = Math.min(act.hits[0]?.from ?? Infinity, act.shoot?.at[0] ?? Infinity, act.dash?.from ?? Infinity);
        const floor = e.weight === 'heavy' ? 36 : 21;
        expect(first, `${e.id}/${a.action}`).toBeGreaterThanOrEqual(floor);
        expect(d.actions[a.action], a.action).toBeDefined();
      }
    }
  });
});

describe('archetypes', () => {
  it('a frostwright under a quarter health fuses, then bursts and dies', () => {
    const { w, p } = arena();
    const f = ring(w, p, 'frostwright', 1, 6)[0]!;
    tickN(w, 5);
    f.hp = Math.floor(f.hpMax * 0.2);
    const ev = tickN(w, 2);
    expect(f.ai!.st).toBe('fuse');
    ev.push(...tickN(w, 130));
    expect(f.dead).toBe(true);
    expect(ev.some((e) => e.k === 'telegraph' && e.src === f.id)).toBe(true);
  });

  it('a burrower cannot be hit while travelling underground', () => {
    const { w, p } = arena();
    const b = ring(w, p, 'burrower', 1, 9)[0]!;
    tickN(w, 10);
    expect(b.ai!.st).toBe('travel');
    p.x = b.x;
    p.z = b.z + 1.5;
    p.fx = 0;
    p.fz = -1;
    const hp = b.hp;
    press(w, BTN.light);
    tickN(w, 15);
    expect(b.hp).toBe(hp);
  });

  it('a mender shields its most hurt ally', () => {
    const { w, p } = arena();
    const [m] = ring(w, p, 'mender', 1, 8);
    const ally = spawnEnemy(w, db(), 'bulwark', m!.x + 1.5, m!.z, 3, []);
    ally.ai!.aggro = true;
    ally.hp = Math.round(ally.hpMax * 0.5);
    p.hp = p.hpMax = 1e9;
    tickN(w, 260);
    expect(ally.shield).toBeGreaterThan(0);
  });

  it('a spiker backs away from a player who closes in', () => {
    const { w, p } = arena();
    const s = spawnEnemy(w, db(), 'spiker', p.x + 2.5, p.z, 3, []);
    s.ai!.aggro = true;
    const d0 = Math.hypot(s.x - p.x, s.z - p.z);
    tickN(w, 40);
    expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(d0 + 1);
  });

  it('a troll with a broken arm stops throwing; a broken leg kneels it for a finisher', () => {
    const { w, p } = arena();
    const t = spawnEnemy(w, db(), 'troll', p.x, p.z - 4, 3, []);
    t.ai!.aggro = true;
    t.parts!.find((x) => x.id === 'armL')!.broken = true;
    p.hp = p.hpMax = 1e9;
    p.x = t.x;
    p.z = t.z + 9;
    const ev = tickN(w, 400);
    expect(ev.some((e) => e.k === 'shoot' && e.src === t.id)).toBe(false);
    // Kneel it, then climb.
    t.stun = 200;
    t.stunKind = 2;
    p.x = t.x;
    p.z = t.z + 2.2;
    const hp = t.hp;
    const fin = [...press(w, BTN.interact), ...tickN(w, 70)];
    expect(fin.some((e) => e.k === 'finisher')).toBe(true);
    expect(hp - t.hp).toBeGreaterThanOrEqual(Math.floor(t.hpMax * 0.35) - 1);
  });
});

describe('encounters, death and the Valkyrie', () => {
  it('walking into an encounter starts it; clearing every wave opens the exits', () => {
    const { w, p } = arena();
    const enc = w.room.encounters[0]!;
    expect(w.room.exits.every((x) => !x.open)).toBe(true);
    p.x = enc.x;
    p.z = enc.z + 2;
    tickN(w, 2);
    expect(enc.state).toBe('active');
    for (let wave = 0; wave < enc.waves.length; wave++) {
      for (const e of w.entities) if (e.kind === 'enemy' && e.ai?.enc === enc.id) e.hp = 0;
      tickN(w, 3);
    }
    expect(enc.state).toBe('done');
    for (const e of w.room.encounters) e.state = 'done';
    tickN(w, 1);
    expect(w.room.cleared).toBe(true);
    expect(w.room.exits.every((x) => x.open)).toBe(true);
    expect(w.zone.cleared).toContain('arena');
  });

  it('dying leaves a tenth of recent bounty as a shade; skipping the Valkyrie after 0.3 s respawns at once', () => {
    const { w, p } = arena();
    const c = w.players[0]!.character;
    c.bounty = 500;
    w.zone.sinceWaystone = 300;
    const enc = w.room.encounters[0]!;
    p.x = enc.x;
    p.z = enc.z + 2;
    tickN(w, 2);
    p.hp = 0;
    tickN(w, 2);
    expect(p.dead).toBe(true);
    expect(c.bounty).toBe(470);
    expect(w.zone.shade?.amount).toBe(30);
    // Too early to skip.
    press(w, BTN.skip);
    expect(p.dead).toBe(true);
    tickN(w, 18);
    press(w, BTN.skip);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(p.hpMax);
    // The unfinished encounter reset; its enemies are gone.
    tickN(w, 2);
    expect(enc.state === 'idle' || enc.state === 'active').toBe(true);
  });

  it('without skipping, the Valkyrie takes 2.5 s, not 30', () => {
    const { w, p } = arena();
    p.hp = 0;
    tickN(w, 1);
    let t = 0;
    while (p.dead && t < 1000) {
      tickN(w, 1);
      t++;
    }
    expect(t).toBeLessThanOrEqual(151);
  });

  it('cleared rooms stay cleared after a death', () => {
    const { w, p } = arena();
    for (const e of w.room.encounters) e.state = 'done';
    tickN(w, 1);
    p.hp = 0;
    tickN(w, 160);
    expect(p.dead).toBe(false);
    expect(w.room.encounters.every((e) => e.state === 'done')).toBe(true);
    expect(w.entities.filter((e) => e.kind === 'enemy').length).toBe(0);
  });
});

describe('sim budget', () => {
  it('steps a 40-enemy brawl within budget', () => {
    const { w, p } = arena();
    p.hp = p.hpMax = 1e9;
    ring(w, p, 'thrall', 16, 5);
    ring(w, p, 'spiker', 8, 9);
    ring(w, p, 'bulwark', 6, 6);
    ring(w, p, 'frostwright', 4, 8);
    ring(w, p, 'mender', 4, 9);
    ring(w, p, 'troll', 2, 7);
    tickN(w, 60);
    const t0 = performance.now();
    const N = 300;
    tickN(w, N, { held: BTN.fire, ax: 40, az: 0 });
    const ms = (performance.now() - t0) / N;
    console.log(`sim step with ${w.entities.filter((e) => e.kind === 'enemy').length} enemies: ${ms.toFixed(3)} ms`);
    // Budget is 1.5 ms on a mid laptop; CI runners vary, so the gate allows headroom.
    expect(ms).toBeLessThan(4);
  });
});
