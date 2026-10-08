import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { tickN, press } from '../_world';
import { createWorld, playerEntity } from '../../../src/core/sim/world';
import { spawnEnemy } from '../../../src/core/sim/spawn';
import { starterCharacter } from '../../../src/core/loot/inventory';
import { BTN } from '../../../src/core/input/frame';
import { T_CRACKED, T_ICE, T_PIT } from '../../../src/core/level/grid';
import { crackIce } from '../../../src/core/level/hazards';
import type { World } from '../../../src/core/sim/types';

function at(zone: string, node: string, opts: { cls?: string; align?: 'human' | 'cyber'; level?: number } = {}): World {
  const c = starterCharacter(db(), 'H', opts.cls ?? 'berserker');
  c.level = opts.level ?? 8;
  c.alignment = opts.align ?? null;
  const w = createWorld({ seed: 3, players: [{ name: 'H', cls: c.cls, character: c }], zone, node }, db());
  // Quiet room: no fights unless a test starts one.
  for (const e of w.room.encounters) e.state = 'done';
  w.room.encounters.push({ id: 99, x: -100, z: -100, radius: 1, state: 'idle', waves: [['thrall']], wave: 0, alive: [], elite: [], level: 1 });
  return w;
}

describe('the Foundry', () => {
  it('conveyors carry what stands on them', () => {
    const w = at('foundry', 'gate');
    const p = playerEntity(w, 0)!;
    const belt = w.room.features.find((f) => f.kind === 'conveyor')!;
    p.x = belt.x;
    p.z = belt.z;
    const x0 = p.x;
    const z0 = p.z;
    tickN(w, 10);
    expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(0.3);
  });

  it('vents warn, then burn anything on them, enemies included', () => {
    const w = at('foundry', 'vents');
    const vent = w.room.features.find((f) => f.kind === 'vent')!;
    const t = spawnEnemy(w, db(), 'thrall', vent.x, vent.z, 7, []);
    t.ai!.st = 'static';
    const hp = t.hp;
    const ev = tickN(w, 60 * 6);
    expect(ev.some((e) => e.k === 'telegraph' && e.shape === 'circle')).toBe(true);
    expect(t.hp).toBeLessThan(hp);
    expect(ev.some((e) => e.k === 'status' && e.dst === t.id && e.status === 'burn') || t.status.burn > 0 || t.dead).toBe(true);
  });

  it('shield pylons make bulwarks invulnerable until destroyed', () => {
    const w = at('foundry', 'smelter', { align: 'cyber' });
    const p = playerEntity(w, 0)!;
    const pylons = w.entities.filter((e) => e.def === 'generator');
    expect(pylons.length).toBe(4);
    const b = spawnEnemy(w, db(), 'bulwark', p.x, p.z - 2, 8, []);
    b.ai!.st = 'static';
    b.fx = 0;
    b.fz = -1; // facing away: no guard
    p.fx = 0;
    p.fz = -1;
    const hp = b.hp;
    const ev = [...press(w, BTN.heavy), ...tickN(w, 50)];
    expect(b.hp).toBe(hp);
    expect(ev.some((e) => e.k === 'immune' && e.dst === b.id)).toBe(true);
    for (const g of pylons) g.hp = 0;
    tickN(w, 2);
    press(w, BTN.heavy);
    tickN(w, 50);
    expect(b.hp).toBeLessThan(hp);
  });

  it('the route forks by aspect: Human gets the catwalks, Cyber the smelter', () => {
    const human = at('foundry', 'vents', { align: 'human' });
    const cyber = at('foundry', 'vents', { align: 'cyber' });
    expect(human.room.exits.map((x) => x.to)).toEqual(['catwalks']);
    expect(cyber.room.exits.map((x) => x.to)).toEqual(['smelter']);
  });

  it('the Well of the Mark: unmarked foes are immune; marked ones are not', () => {
    const w = at('foundry', 'wyrd');
    const p = playerEntity(w, 0)!;
    const t = spawnEnemy(w, db(), 'thrall', p.x, p.z - 2, 8, []);
    t.ai!.st = 'static';
    p.fx = 0;
    p.fz = -1;
    const hp = t.hp;
    press(w, BTN.light);
    tickN(w, 20);
    expect(t.hp).toBe(hp);
    t.status.burn = 120;
    t.status.burnDmg = 0;
    tickN(w, 20);
    press(w, BTN.light);
    tickN(w, 20);
    expect(t.hp).toBeLessThan(hp);
  });
});

describe('the Roots', () => {
  it('heavy blows crack thin ice; it gives way and drops what stands on it', () => {
    const w = at('roots', 'descent', { level: 12 });
    const room = w.room;
    const i = room.tiles.indexOf(T_ICE);
    const x = (i % room.w) + 0.5;
    const z = Math.floor(i / room.w) + 0.5;
    const t = spawnEnemy(w, db(), 'thrall', x, z, 10, []);
    t.ai!.st = 'static';
    crackIce(w, x, z, 0.8);
    expect(room.tiles[i]).toBe(T_CRACKED);
    const ver = room.ver;
    tickN(w, 100);
    expect(room.tiles[i]).toBe(T_PIT);
    expect(room.ver).toBeGreaterThan(ver);
    expect(t.dead).toBe(true);
  });

  it('geysers launch nearby enemies', () => {
    const w = at('roots', 'geysers', { level: 12 });
    const g = w.room.features.find((f) => f.kind === 'geyser')!;
    const t = spawnEnemy(w, db(), 'thrall', g.x + 0.5, g.z, 10, []);
    t.ai!.st = 'static';
    let maxY = 0;
    for (let k = 0; k < 400; k++) {
      tickN(w, 1);
      maxY = Math.max(maxY, t.y);
    }
    expect(maxY).toBeGreaterThan(1);
  });

  it('the Well of Standing forbids dodging', () => {
    const w = at('roots', 'wyrd', { level: 12 });
    const p = playerEntity(w, 0)!;
    const ev = press(w, BTN.dodge, { mx: 127 });
    expect(p.act?.id.startsWith('dodge') ?? false).toBe(false);
    expect(ev.some((e) => e.k === 'immune')).toBe(true);
  });
});
