import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { tickN } from '../_world';
import { createWorld, playerEntity } from '../../../src/core/sim/world';
import { applyHit, profile } from '../../../src/core/combat/hits';
import { choosePattern, readOf } from '../../../src/core/ai/boss';
import { newBoss } from '../../../src/core/ai/bossState';
import { T_CRACKED, T_PIT, tileAt } from '../../../src/core/level/grid';
import type { Entity, World } from '../../../src/core/sim/types';

/** The caldera with the fight started: the player walks in and the boss and guardian rise. */
function caldera(seed = 5): { w: World; p: Entity; boss: Entity; guard: Entity } {
  const w = createWorld({ seed, players: [{ name: 'A', cls: 'berserker' }], zone: 'roots', node: 'caldera' }, db());
  const p = playerEntity(w, 0)!;
  p.hp = p.hpMax = 1e7;
  const enc = w.room.encounters[0]!;
  p.x = p.px = enc.x;
  p.z = p.pz = enc.z + 6;
  tickN(w, 2);
  const boss = w.entities.find((e) => e.boss)!;
  const guard = w.entities.find((e) => e.def === 'mokkurkalfi')!;
  return { w, p, boss, guard };
}

function blow(w: World, p: Entity, t: Entity, base: number, ranged = false) {
  const prof = { ...profile(w, db(), p, ranged), base, critChance: 0 };
  return applyHit(w, db(), { src: p, dx: 0, dz: -1, hit: { dmg: 1, poise: 0, launch: 0, knock: 0, down: false, stop: 0, status: null, guardBreak: false, tag: 'heavy', cap: 0 }, ranged, px: t.x, pz: t.z, prof }, t);
}

describe('Hrungnir', () => {
  it('spawns plated, in phase 1, with its guardian', () => {
    const { boss, guard } = caldera();
    expect(boss.boss!.phase).toBe(1);
    expect(boss.boss!.plating).toBeGreaterThan(0);
    expect(guard).toBeDefined();
  });

  it('no blow skips a phase: damage stops at the floor, then an invulnerable transition', () => {
    const { w, p, boss } = caldera();
    const floor = boss.boss!.floor;
    expect(floor).toBe(Math.round(boss.hpMax * 0.66));
    blow(w, p, boss, 1e8);
    expect(boss.hp).toBe(floor);
    const ev = tickN(w, 1);
    expect(boss.boss!.phase).toBe(2);
    expect(ev.some((e) => e.k === 'boss' && e.what === 'phase' && e.value === '2')).toBe(true);
    // Mid-transition every blow is turned aside.
    expect(blow(w, p, boss, 1e8)).toBe('immune');
    expect(boss.hp).toBe(floor);
    tickN(w, db().bosses.hrungnir!.transition + 5);
    expect(blow(w, p, boss, 1e8)).toBe('hit');
    expect(boss.hp).toBe(Math.round(boss.hpMax * 0.33));
  });

  it('phase 2 breaks the guardian and its plates for good', () => {
    const { w, p, boss, guard } = caldera();
    blow(w, p, boss, 1e8);
    tickN(w, 2);
    expect(guard.dead).toBe(true);
    expect(boss.boss!.plating).toBe(0);
    expect(boss.boss!.platingMax).toBe(0);
  });

  it('phase 3 cracks the arena beyond its radius; the ground falls; a death restores it', () => {
    const { w, p, boss } = caldera();
    const bd = db().bosses.hrungnir!;
    blow(w, p, boss, 1e8);
    tickN(w, bd.transition + 10);
    blow(w, p, boss, 1e8);
    tickN(w, 1);
    expect(boss.boss!.phase).toBe(3);
    const b = boss.boss!;
    const outside = (tx: number, tz: number) => (tx + 0.5 - b.cx) * (tx + 0.5 - b.cx) + (tz + 0.5 - b.cz) * (tz + 0.5 - b.cz) > bd.arena[0]! * bd.arena[0]!;
    const cracked = w.room.tiles.filter((t) => t === T_CRACKED).length;
    expect(cracked).toBeGreaterThan(40);
    // Stand on doomed ground: when it falls, the player is hauled inside, not drowned.
    p.x = p.px = b.cx;
    p.z = p.pz = b.cz + bd.arena[0]! + 1.2;
    const hp = p.hp;
    tickN(w, 160);
    expect(w.room.tiles.filter((t) => t === T_PIT).length).toBe(cracked);
    expect(tileAt(w.room, Math.floor(p.x), Math.floor(p.z))).not.toBe(T_PIT);
    expect(p.hp).toBeLessThan(hp);
    for (let tz = 0; tz < w.room.h; tz++) for (let tx = 0; tx < w.room.w; tx++) if (w.room.tiles[tz * w.room.w + tx] === T_PIT) expect(outside(tx, tz)).toBe(true);
    // The player falls; the fight resets on whole ground.
    p.hp = 0;
    tickN(w, 200, { pressed: 1 << 12 });
    tickN(w, 400);
    expect(w.room.tiles.some((t) => t === T_PIT || t === T_CRACKED)).toBe(false);
  });

  it('reads how its target fights from what it observes', () => {
    const { p } = caldera();
    const span = 300;
    const pl = p.pl!;
    Object.assign(pl, { obsNear: 0, obsFar: 0, obsDodge: 4 });
    expect(readOf(p, span)).toBe('dodgy');
    Object.assign(pl, { obsNear: 200, obsFar: 0, obsDodge: 1 });
    expect(readOf(p, span)).toBe('close');
    Object.assign(pl, { obsNear: 20, obsFar: 250, obsDodge: 0 });
    expect(readOf(p, span)).toBe('far');
    Object.assign(pl, { obsNear: 100, obsFar: 100, obsDodge: 0 });
    expect(readOf(p, span)).toBe('mid');
  });

  it('answers the read: kiters get charges, volleys and summons; huggers get shockwaves and leaps', () => {
    const { w, boss } = caldera();
    const bd = db().bosses.hrungnir!;
    const share = (read: string, d: number) => {
      const b = { ...newBoss(boss, bd), phase: 2, read };
      let hit = 0;
      for (let i = 0; i < 2000; i++) {
        const id = choosePattern(w, bd, b, d, 0);
        if (bd.patterns.find((p) => p.id === id)!.vs.includes(read)) hit++;
      }
      return hit / 2000;
    };
    expect(share('far', 10)).toBeGreaterThan(0.6);
    expect(share('close', 3)).toBeGreaterThan(0.6);
    expect(share('dodgy', 3)).toBeGreaterThan(0.3);
  });

  it('never runs a pattern three times in a row, adaptive or scripted', () => {
    const { w, boss } = caldera();
    const bd = db().bosses.hrungnir!;
    for (const read of ['far', 'close', 'mid', 'dodgy']) {
      const b = { ...newBoss(boss, bd), phase: 2, read, history: [] as string[] };
      for (let i = 0; i < 3000; i++) {
        const id = choosePattern(w, bd, b, 3, 0);
        b.history.push(id);
        if (b.history.length > 4) b.history.shift();
        const h = b.history;
        if (h.length >= 3) expect(h[h.length - 1] === h[h.length - 2] && h[h.length - 2] === h[h.length - 3]).toBe(false);
      }
    }
    const f = bd.final;
    for (let i = 0; i < f.length; i++) expect(f[i] === f[(i + 1) % f.length] && f[i] === f[(i + 2) % f.length]).toBe(false);
  });

  it('the guardian re-plates its master unless the channel is broken', () => {
    const { w, boss, guard, p } = caldera();
    const bd = db().bosses.hrungnir!;
    boss.boss!.plating = 0;
    guard.ai!.c = bd.replate - 1;
    guard.act = null;
    let ev = tickN(w, 2);
    expect(guard.ai!.st).toBe('channel');
    expect(ev.some((e) => e.k === 'boss' && e.what === 'channel')).toBe(true);
    ev = tickN(w, bd.channel + 2);
    expect(ev.some((e) => e.k === 'boss' && e.what === 'plated')).toBe(true);
    expect(boss.boss!.plating).toBe(boss.boss!.platingMax);

    boss.boss!.plating = 0;
    guard.ai!.c = bd.replate - 1;
    guard.act = null;
    guard.ai!.st = 'chase';
    tickN(w, 2);
    expect(guard.ai!.st).toBe('channel');
    blow(w, p, guard, guard.hpMax * 0.2);
    ev = tickN(w, bd.channel + 2);
    expect(ev.some((e) => e.k === 'boss' && e.what === 'interrupt')).toBe(true);
    expect(boss.boss!.plating).toBe(0);
  });

  it('stone hide: shots chip the boss until its heart is exposed', () => {
    const { w, p, boss } = caldera();
    boss.boss!.plating = 0;
    boss.boss!.floor = 0;
    boss.hp = boss.hpMax;
    blow(w, p, boss, 1000, true);
    const covered = boss.hpMax - boss.hp;
    boss.hp = boss.hpMax;
    boss.boss!.exposed = 60;
    blow(w, p, boss, 1000, true);
    const open = boss.hpMax - boss.hp;
    // Exposed also counts as a weak point, so compare against the hide's share, not equality.
    expect(covered).toBeLessThan(open * 0.5);
    expect(covered).toBeGreaterThan(0);
  });
});
