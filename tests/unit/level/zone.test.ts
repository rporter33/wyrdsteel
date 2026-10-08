import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { tickN, press } from '../_world';
import { createWorld, playerEntity } from '../../../src/core/sim/world';
import { step } from '../../../src/core/sim/step';
import { applyCommand } from '../../../src/core/sim/apply';
import { spawnEnemy } from '../../../src/core/sim/spawn';
import { botInput, newMemory } from '../../../src/core/bot/policies';
import { starterCharacter } from '../../../src/core/loot/inventory';
import { BTN } from '../../../src/core/input/frame';
import { inHeat } from '../../../src/core/level/hazards';
import type { SimEvent, World } from '../../../src/core/sim/types';

function zoneWorld(zone: string, node: string, level = 1, seed = 5): World {
  const c = starterCharacter(db(), 'Z', 'berserker');
  c.level = level;
  return createWorld({ seed, players: [{ name: 'Z', cls: 'berserker', character: c }], zone, node }, db());
}

describe('the citadel and travel', () => {
  it('a new game opens in Gladsheim with the intro, played once', () => {
    const w = zoneWorld('citadel', 'hub');
    const ev = tickN(w, 2);
    expect(ev.filter((e) => e.k === 'story').map((e) => (e as { beat: string }).beat)).toEqual(['intro']);
    expect(w.players[0]!.character.story['beat:intro']).toBe(1);
  });

  it('the gate travels to the Iron Wood; later zones wait on the story; not mid-fight', () => {
    const w = zoneWorld('citadel', 'hub');
    tickN(w, 1);
    expect(applyCommand(w, 0, { t: 'travel', zone: 'nowhere', node: '' }, db())).toMatch(/Unknown/);
    expect(applyCommand(w, 0, { t: 'travel', zone: 'ironwood', node: '' }, db())).toBeNull();
    const ev = tickN(w, 2);
    expect(w.zone.id).toBe('ironwood');
    expect(w.room.id).toBe('iw.edge');
    expect(ev.some((e) => e.k === 'story' && e.beat === 'iw.arrive')).toBe(true);
    const p = playerEntity(w, 0)!;
    const enc = w.room.encounters[0]!;
    p.x = enc.x;
    p.z = enc.z + 2;
    tickN(w, 2);
    expect(applyCommand(w, 0, { t: 'travel', zone: 'citadel', node: 'hub' }, db())).toMatch(/fighting/);
  });
});

describe('the Iron Wood', () => {
  it('a blizzard surge chills anyone outside heat; a lit brazier keeps you warm', () => {
    const w = zoneWorld('ironwood', 'clearing', 3);
    const p = playerEntity(w, 0)!;
    p.hp = p.hpMax = 1e9;
    // Keep the room uncleared (surges stop once a room is won) without starting a fight.
    for (const enc of w.room.encounters) enc.state = 'done';
    w.room.encounters.push({ id: 9, x: -100, z: -100, radius: 1, state: 'idle', waves: [['thrall']], wave: 0, alive: [], elite: [], level: 1 });
    const br = w.room.features.find((f) => f.kind === 'brazier')!;
    w.room.surgeAt = w.tick + 5;
    // Out in the cold.
    p.x = br.x + 8;
    p.z = br.z;
    tickN(w, 6 + 300);
    expect(p.status.chill > 0 || p.status.freeze > 0 || p.status.b[1]! > 50).toBe(true);
    // Light the brazier by hand and stand by it.
    p.status.b[1] = 0;
    p.status.chill = 0;
    p.status.freeze = 0;
    p.x = br.x + 1.2;
    p.z = br.z;
    const ev = press(w, BTN.interact);
    expect(ev.some((e) => e.k === 'hazard' && e.what === 'brazier')).toBe(true);
    expect(inHeat(w, p)).toBe(true);
    tickN(w, 200);
    expect(p.status.b[1]).toBe(0);
    expect(p.status.chill).toBe(0);
  });

  it('a shot lights a brazier from range', () => {
    const w = createWorld({ seed: 2, players: [{ name: 'C', cls: 'commando' }], zone: 'ironwood', node: 'clearing' }, db());
    const p = playerEntity(w, 0)!;
    const br = w.room.features.find((f) => f.kind === 'brazier')!;
    p.x = br.x;
    p.z = br.z + 5;
    const ev = tickN(w, 30, { held: BTN.fire, ax: 0, az: -80 });
    expect(ev.some((e) => e.k === 'hazard' && e.what === 'brazier') || br.a > 0).toBe(true);
  });

  it('the Well of the Air: grounded foes are immune; launched foes take damage; clearing it grants a sigil', () => {
    const w = zoneWorld('ironwood', 'wyrd', 4);
    const p = playerEntity(w, 0)!;
    for (const enc of w.room.encounters) enc.state = 'done';
    const t = spawnEnemy(w, db(), 'thrall', p.x, p.z - 2, 2, []);
    t.ai!.st = 'static';
    p.fx = 0;
    p.fz = -1;
    const hp = t.hp;
    const ev: SimEvent[] = [...press(w, BTN.light), ...tickN(w, 20)];
    expect(t.hp).toBe(hp);
    expect(ev.some((e) => e.k === 'immune')).toBe(true);
    tickN(w, 30);
    ev.push(...press(w, BTN.launcher), ...tickN(w, 16, { held: BTN.launcher }));
    expect(t.y).toBeGreaterThan(0.3);
    ev.push(...press(w, BTN.light), ...tickN(w, 12));
    expect(t.hp).toBeLessThan(hp);
    // Clear the room: a sigil.
    t.hp = 0;
    w.room.encounters.push({ id: 9, x: 1, z: 1, radius: 1, state: 'done', waves: [], wave: 0, alive: [], elite: [], level: 1 });
    w.room.cleared = false;
    tickN(w, 3);
    expect(w.players[0]!.character.sigils).toBe(1);
  });

  it('clearing the den sets the alignment offer, plays the wound, and sends you home', () => {
    const w = zoneWorld('ironwood', 'den', 6);
    for (const enc of w.room.encounters) enc.state = 'done';
    const ev = tickN(w, 4);
    const c = w.players[0]!.character;
    expect(c.story['align.offer']).toBe(1);
    expect(c.story['zone.ironwood']).toBe(1);
    expect(ev.some((e) => e.k === 'story' && e.beat === 'troll.wound')).toBe(true);
    expect(w.zone.id).toBe('citadel');
    expect(w.room.id).toBe('hub');
  });

  it('choosing an aspect at the well plays its beat', () => {
    const w = zoneWorld('citadel', 'hub', 6);
    w.players[0]!.character.story['align.offer'] = 1;
    tickN(w, 1);
    expect(applyCommand(w, 0, { t: 'chooseAlignment', a: 'cyber' }, db())).toBeNull();
    const ev = tickN(w, 1);
    void ev;
    expect(w.players[0]!.character.story['beat:align.cyber']).toBe(1);
  });
});

describe('the bot walks the Iron Wood', () => {
  it('from the edge to the den and home, through the real input API', () => {
    const c = starterCharacter(db(), 'Bot', 'berserker');
    c.level = 7;
    for (const n of ['zk.wolf.hide', 'zk.wolf.hide', 'zk.wolf.hide', 'zk.rage.fury', 'zk.rage.fury', 'zk.rage.howl']) c.skills.cls[n] = (c.skills.cls[n] ?? 0) + 1;
    const w = createWorld({ seed: 11, players: [{ name: 'Bot', cls: 'berserker', character: c }], zone: 'ironwood', node: 'edge' }, db());
    const mem = newMemory();
    let events: SimEvent[] = [];
    const visited: string[] = [];
    let deaths = 0;
    for (let t = 0; t < 60 * 60 * 12 && w.zone.id === 'ironwood'; t++) {
      // Light braziers on the way: the bot stands in heat during surges via its threat logic only.
      step(w, { tick: w.tick, inputs: [botInput(w, db(), 0, 'tactical', mem, events)] }, db());
      events = w.events;
      for (const ev of events) if (ev.k === 'playerDown') deaths++;
      if (visited[visited.length - 1] !== w.zone.node) visited.push(w.zone.node);
    }
    expect(visited.slice(0, 5)).toEqual(['edge', 'clearing', 'grove', 'hollow', 'den']);
    expect(w.zone.id).toBe('citadel');
    expect(w.players[0]!.character.story['zone.ironwood']).toBe(1);
    expect(deaths).toBeLessThanOrEqual(2);
  });
});
