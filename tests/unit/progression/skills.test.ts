import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { training, tickN } from '../_world';
import { applyCommand } from '../../../src/core/sim/apply';
import { canRank, classPoints, aspectPoints, respecCost, swapCost, validateAllocation, CAPSTONE_POINTS } from '../../../src/core/progression/skills';
import { LEVEL_CAP } from '../../../src/core/progression/rewards';
import { newCharacter } from '../../../src/core/progression/character';
import { spawnEnemy } from '../../../src/core/sim/spawn';
import { BTN } from '../../../src/core/input/frame';

describe('skill trees', () => {
  const d = db();
  const trees = [...Object.values(d.classes).map((c) => c.tree), d.alignTrees.human, d.alignTrees.cyber];
  for (const tree of trees) {
    it(`${tree.id} is a DAG of reachable nodes with real abilities`, () => {
      const ids = new Set(tree.nodes.map((n) => n.id));
      expect(ids.size).toBe(tree.nodes.length);
      for (const n of tree.nodes) {
        for (const r of n.requires) {
          expect(ids.has(r), `${n.id} requires ${r}`).toBe(true);
          const req = tree.nodes.find((m) => m.id === r)!;
          expect(req.row, `${n.id} row`).toBeLessThan(n.row);
        }
        if (n.ability) expect(d.abilities[n.ability], n.ability).toBeDefined();
        for (const ef of n.effects) expect(typeof ef.amt).toBe('number');
      }
    });
  }

  it('a level-cap character can reach a capstone in each class path', () => {
    const c = newCharacter('X', 'berserker');
    c.level = LEVEL_CAP;
    const pts = classPoints(c);
    expect(pts).toBeGreaterThanOrEqual(CAPSTONE_POINTS + 1);
  });

  it('every class ability unlocks from its own tree or starts unlocked', () => {
    for (const cls of Object.values(d.classes)) {
      for (const id of cls.abilities) {
        const a = d.abilities[id]!;
        if (a.unlock) expect(cls.tree.nodes.some((n) => n.id === a.unlock), `${id} -> ${a.unlock}`).toBe(true);
      }
      expect(cls.abilities.some((id) => !d.abilities[id]!.unlock), `${cls.id} has a starting ability`).toBe(true);
    }
  });
});

describe('allocation', () => {
  it('refuses ranks without points, without the prerequisite, or past the capstone gate', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    expect(applyCommand(w, 0, { t: 'allocSkill', node: 'zk.wolf.hide', tree: 'cls' }, db())).toBe('No points');
    c.level = 12;
    expect(applyCommand(w, 0, { t: 'allocSkill', node: 'zk.wolf.thirst', tree: 'cls' }, db())).toMatch(/Needs/);
    const armor = w.players[0]!.stats.armor;
    expect(applyCommand(w, 0, { t: 'allocSkill', node: 'zk.wolf.hide', tree: 'cls' }, db())).toBeNull();
    expect(w.players[0]!.stats.armor).toBe(armor + 4 + 22);
    expect(validateAllocation(db().classes.berserker!.tree, c.skills.cls, classPoints(c), 'berserker')).toEqual([]);
    const tree = db().classes.berserker!.tree;
    const cap = tree.nodes.find((n) => n.id === 'zk.wolf.fenrir')!;
    expect(canRank(tree, { 'zk.wolf.pelt': 1, 'zk.wolf.hide': 1 }, cap, 30, 'berserker')).toMatch(/10 points/);
  });

  it('unlocking an ability node makes the ability usable', () => {
    const { w, p } = training();
    w.players[0]!.character.level = 3;
    applyCommand(w, 0, { t: 'allocSkill', node: 'zk.storm.updraft', tree: 'cls' }, db());
    expect(applyCommand(w, 0, { t: 'allocSkill', node: 'zk.storm.leap', tree: 'cls' }, db())).toBeNull();
    // Rend is slot 1 (free), Leap now slot 2.
    const ev = tickN(w, 1, { pressed: BTN.ab2, held: BTN.ab2 });
    expect(ev.some((e) => e.k === 'ability' && e.id === 'zerk.leap')).toBe(true);
    void p;
  });

  it('respec is free early and for the first time, then costs more each time', () => {
    const c = newCharacter('X', 'berserker');
    c.level = 8;
    expect(respecCost(c)).toBe(0);
    c.level = 15;
    expect(respecCost(c)).toBe(0);
    c.skills.respecs = 1;
    const a = respecCost(c);
    c.skills.respecs = 2;
    expect(respecCost(c)).toBeGreaterThan(a);
    c.skills.respecs = 50;
    expect(respecCost(c)).toBe(2500);
  });
});

describe('aspects', () => {
  it('each aspect keeps its own points: swapping and swapping back loses nothing', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    c.level = 10;
    expect(applyCommand(w, 0, { t: 'allocSkill', node: 'hu.a.fleet', tree: 'human' }, db())).toMatch(/not yours/);
    expect(applyCommand(w, 0, { t: 'chooseAlignment', a: 'human' }, db())).toBeNull();
    expect(aspectPoints(c)).toBe(6);
    applyCommand(w, 0, { t: 'allocSkill', node: 'hu.a.fleet', tree: 'human' }, db());
    applyCommand(w, 0, { t: 'allocSkill', node: 'hu.a.fleet', tree: 'human' }, db());
    const fast = w.players[0]!.stats.speed;
    expect(applyCommand(w, 0, { t: 'swapAspect' }, db())).toBeNull();
    expect(c.alignment).toBe('cyber');
    expect(w.players[0]!.stats.speed).toBeLessThan(fast);
    applyCommand(w, 0, { t: 'allocSkill', node: 'cy.a.plate', tree: 'cyber' }, db());
    c.bounty = 1000;
    expect(swapCost(c)).toBe(300);
    expect(applyCommand(w, 0, { t: 'swapAspect' }, db())).toBeNull();
    expect(c.bounty).toBe(700);
    expect(c.skills.aspect.human['hu.a.fleet']).toBe(2);
    expect(c.skills.aspect.cyber['cy.a.plate']).toBe(1);
    expect(w.players[0]!.stats.speed).toBeCloseTo(fast, 9);
  });

  it('class-locked capstones refuse the other class', () => {
    const tree = db().alignTrees.human;
    const node = tree.nodes.find((n) => n.id === 'hu.hunt')!;
    const alloc: Record<string, number> = {};
    for (const n of tree.nodes) if (n.row < 5) alloc[n.id] = n.maxRank;
    expect(canRank(tree, alloc, node, 99, 'berserker')).toBe('Other class');
    expect(canRank(tree, alloc, node, 99, 'commando')).toBeNull();
  });
});

describe('charm quests', () => {
  it('killing the asked-for foes the asked-for way completes a charm and grants a point', () => {
    const { w, p } = training();
    const c = w.players[0]!.character;
    expect(applyCommand(w, 0, { t: 'takeQuest', charm: 'charm.storm' }, db())).toBeNull();
    const charmPoints = () => classPoints(c) - (c.level - 1);
    const before = charmPoints();
    for (let i = 0; i < 15; i++) {
      const e = spawnEnemy(w, db(), 'thrall', p.x + 3, p.z, 1, []);
      e.lastHit = p.id;
      e.lastHow = i < 3 ? 0 : 1; // the first three are not airborne kills
      e.hp = 0;
      tickN(w, 1);
    }
    expect(c.charms[0]!.done).toBe(false);
    for (let i = 0; i < 3; i++) {
      const e = spawnEnemy(w, db(), 'thrall', p.x + 3, p.z, 1, []);
      e.lastHit = p.id;
      e.lastHow = 1;
      e.hp = 0;
      tickN(w, 1);
    }
    expect(c.charms[0]!.done).toBe(true);
    expect(charmPoints()).toBe(before + 1);
    expect(c.inv.some((i) => db().bases[i.base]?.ruiner === 'ruiner.storm')).toBe(true);
  });
});
