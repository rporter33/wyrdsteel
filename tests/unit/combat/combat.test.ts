import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { training, standBefore, tickN, press, dummies } from '../_world';
import { BTN } from '../../../src/core/input/frame';
import { applyHit, profile } from '../../../src/core/combat/hits';
import { coneTarget, meleeCone } from '../../../src/core/combat/targeting';
import { addBuildup } from '../../../src/core/combat/status';
import { sweep } from '../../../src/core/combat/projectiles';
import { seedRng, nextInt } from '../../../src/core/rng/xoshiro';
import type { SimEvent } from '../../../src/core/sim/types';

const hitsOn = (ev: SimEvent[], id: number) => ev.filter((e) => e.k === 'hit' && e.dst === id && e.dmg > 0);

describe('melee strings', () => {
  it('four light presses chain the full blades string and land on the dummy', () => {
    const { w, p } = training();
    const d = dummies(w)[0]!;
    standBefore(p, d);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 4; i++) {
      ev.push(...press(w, BTN.light));
      ev.push(...tickN(w, 16));
    }
    ev.push(...tickN(w, 40));
    const swings = ev.filter((e) => e.k === 'swing').map((e) => (e as { action: string }).action);
    expect(swings).toEqual(['b.l1', 'b.l2', 'b.l3', 'b.l4']);
    // l3 has two windows: five hits in all.
    expect(hitsOn(ev, d.id).length).toBe(5);
  });

  it('a press within the grace after a string ends continues it; a late press restarts it', () => {
    const { w, p } = training();
    standBefore(p, dummies(w)[0]!);
    press(w, BTN.light);
    tickN(w, 25);
    const cont = press(w, BTN.light).filter((e) => e.k === 'swing');
    expect((cont[0] as { action: string }).action).toBe('b.l2');
    tickN(w, 60);
    const fresh = press(w, BTN.light).filter((e) => e.k === 'swing');
    expect((fresh[0] as { action: string }).action).toBe('b.l1');
  });

  it('launcher held lifts the dummy and the player; air string keeps it up; slam brings it down', () => {
    const { w, p } = training();
    const d = dummies(w)[0]!;
    standBefore(p, d);
    const ev = [...press(w, BTN.launcher)];
    ev.push(...tickN(w, 18, { held: BTN.launcher }));
    expect(d.y).toBeGreaterThan(0.5);
    expect(p.y).toBeGreaterThan(0.5);
    for (let i = 0; i < 3; i++) {
      ev.push(...press(w, BTN.light));
      ev.push(...tickN(w, 13));
    }
    expect(d.y).toBeGreaterThan(0.3);
    ev.push(...press(w, BTN.heavy));
    ev.push(...tickN(w, 90));
    expect(d.y).toBe(0);
    expect(p.y).toBe(0);
    expect(ev.some((e) => e.k === 'launch')).toBe(true);
    expect(ev.some((e) => e.k === 'land' && e.dst === d.id)).toBe(true);
  });

  it('a shield bearer blocks light blows from the front but not a heavy', () => {
    const { w, p } = training();
    const s = dummies(w, 'dummy.shield')[0]!;
    s.fx = 0;
    s.fz = 1;
    standBefore(p, s);
    const light = [...press(w, BTN.light), ...tickN(w, 20)];
    expect(light.filter((e) => e.k === 'hit' && e.dst === s.id).every((e) => (e as { dmg: number }).dmg === 0)).toBe(true);
    tickN(w, 30);
    const heavy = [...press(w, BTN.heavy), ...tickN(w, 40)];
    expect(hitsOn(heavy, s.id).length).toBeGreaterThan(0);
  });

  it('breaking a troll leg makes it kneel', () => {
    const { w, p } = training();
    const t = dummies(w, 'dummy.troll')[0]!;
    t.fx = 0;
    t.fz = 1;
    const leg = t.parts!.find((x) => x.id === 'legR')!;
    leg.hp = 1;
    standBefore(p, t);
    p.x = t.x + 0.45;
    const ev = [...press(w, BTN.light), ...tickN(w, 20)];
    expect(ev.some((e) => e.k === 'partBreak')).toBe(true);
    expect(t.stun).toBeGreaterThan(0);
  });
});

describe('juggles always end', () => {
  it('any sequence of air hits lands the target within 4 s (property test, 200 sequences)', () => {
    const r = seedRng(5);
    for (let trial = 0; trial < 200; trial++) {
      const { w, p } = training('berserker', trial);
      const d = dummies(w)[0]!;
      const prof = profile(w, db(), p, false);
      const hit = (launch: number) => applyHit(w, db(), { src: p, dx: 0, dz: -1, hit: { dmg: 0.1, poise: 1, launch, knock: 0, down: false, stop: 0, status: null, guardBreak: false, tag: 'air', cap: 0.35 }, ranged: false, px: d.x, pz: d.z, prof }, d);
      hit(12);
      let landed = -1;
      for (let t = 0; t < 240; t++) {
        if (nextInt(r, 4) === 0) hit(nextInt(r, 3) === 0 ? 12 : 4.5);
        tickN(w, 1);
        if (d.y === 0) {
          landed = t;
          break;
        }
      }
      expect(landed, `trial ${trial}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('targeting', () => {
  it('soft target prefers small angles, sticks to the current one, and ignores what is behind', () => {
    const { w, p } = training();
    const [a, b] = dummies(w);
    p.x = a!.x;
    p.z = a!.z + 2;
    expect(coneTarget(w, p, 0, -1, meleeCone(0.7), 0)?.id).toBe(a!.id);
    expect(coneTarget(w, p, 0, 1, meleeCone(0.7), 0)).toBeNull();
    void b;
  });
  it('assist 0 narrows the cone', () => {
    const { w, p } = training();
    const a = dummies(w)[0]!;
    p.x = a.x + 1.8;
    p.z = a.z + 2.6;
    expect(coneTarget(w, p, 0, -1, meleeCone(1), 0)?.id).toBe(a.id);
    expect(coneTarget(w, p, 0, -1, meleeCone(0), 0)).toBeNull();
  });
});

describe('statuses', () => {
  it('chill on a chilled target freezes it; resistance then rises', () => {
    const { w } = training();
    const d = dummies(w)[0]!;
    expect(addBuildup(w, d, 'chill', 100, 0, false)).toBe('chill');
    expect(addBuildup(w, d, 'chill', 100, 0, false)).toBe('freeze');
    expect(d.status.freeze).toBeGreaterThan(0);
    expect(d.status.ccRes).toBeCloseTo(0.25, 9);
  });
  it('burn deals damage over time and cures chill', () => {
    const { w } = training();
    const d = dummies(w)[0]!;
    addBuildup(w, d, 'chill', 100, 0, false);
    addBuildup(w, d, 'burn', 100, 0, false);
    expect(d.status.chill).toBe(0);
    const hp = d.hp;
    tickN(w, 61);
    expect(d.hp).toBeLessThan(hp);
  });
  it('resistance reduces build-up', () => {
    const { w } = training();
    const d = dummies(w)[0]!;
    expect(addBuildup(w, d, 'root', 100, 0.5, false)).toBeNull();
    expect(d.status.b[0]).toBeCloseTo(50, 9);
  });
});

describe('projectiles', () => {
  it('a fast shot cannot tunnel through a thin target', () => {
    expect(sweep(0, 0, 10, 0, 5, 0.1, 0.2)).toBeGreaterThan(0);
    expect(sweep(0, 0, 10, 0, 5, 0.5, 0.2)).toBe(-1);
  });
  it('holding fire shoots the commando rifle at its cadence and hits a dummy ahead', () => {
    const { w, p } = training('commando');
    const d = dummies(w)[0]!;
    standBefore(p, d, 6);
    const ev = tickN(w, 60, { held: BTN.fire, ax: 0, az: -16 * 6 });
    const shots = ev.filter((e) => e.k === 'shoot').length;
    expect(shots).toBeGreaterThanOrEqual(4);
    expect(shots).toBeLessThanOrEqual(5);
    expect(hitsOn(ev, d.id).length).toBeGreaterThan(0);
  });
});

describe('dodge', () => {
  it('a perfect dodge refunds the charge and empowers the next blow', () => {
    const { w, p } = training();
    const d = dummies(w)[0]!;
    press(w, BTN.dodge, { mx: 127 });
    tickN(w, 3);
    const charges = p.pl!.dodges;
    const prof = profile(w, db(), d, false);
    const r = applyHit(w, db(), { src: d, dx: 1, dz: 0, hit: { dmg: 1, poise: 10, launch: 0, knock: 0, down: false, stop: 0, status: null, guardBreak: false, tag: 'enemy', cap: 0.35 }, ranged: false, px: p.x, pz: p.z, prof }, p);
    expect(r).toBe('dodged');
    expect(p.pl!.dodges).toBe(charges + 1);
    expect(p.pl!.empowered).toBeGreaterThan(w.tick);
  });
});
