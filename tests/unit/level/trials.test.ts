import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { tickN } from '../_world';
import { createWorld } from '../../../src/core/sim/world';
import { applyCommand } from '../../../src/core/sim/apply';
import { bestTier, shiftWeights, trialMods, TRIAL_MAX } from '../../../src/core/level/trials';
import { starterCharacter } from '../../../src/core/loot/inventory';
import type { World } from '../../../src/core/sim/types';

function hub(chapter = true, seed = 9): World {
  const c = starterCharacter(db(), 'T', 'berserker');
  c.level = 16;
  if (chapter) c.story.chapter = 1;
  c.story['zone.foundry'] = 1;
  c.story['alignment'] = 1;
  c.story['zone.roots'] = 1;
  return createWorld({ seed, players: [{ name: 'T', cls: 'berserker', character: c }], zone: 'citadel', node: 'hub' }, db());
}

function enter(w: World, zone: string, tier: number): string | null {
  const c = w.players[0]!.character;
  const why = applyCommand(w, 0, { t: 'travel', zone, node: '', trial: tier, mods: trialMods(db(), c, zone, tier) }, db());
  if (!why) tickN(w, 1);
  return why;
}

describe('Wyrd Trials', () => {
  it('open only once the chapter is done, one tier at a time, on the terms the gate showed', () => {
    expect(enter(hub(false), 'ironwood', 1)).toMatch(/chapter/);
    const w = hub();
    expect(enter(w, 'ironwood', 3)).toMatch(/tier below/);
    const c = w.players[0]!.character;
    expect(applyCommand(w, 0, { t: 'travel', zone: 'ironwood', node: '', trial: 1, mods: ['t.gilded'] }, db())).toMatch(/terms/);
    expect(enter(w, 'ironwood', 1)).toBeNull();
    expect(w.zone.id).toBe('ironwood');
    expect(w.zone.trial).toBe(1);
    expect(w.zone.mods.length).toBeGreaterThan(0);
    expect(c.story['trials.runs']).toBe(1);
  });

  it('modifiers are fixed by zone, tier and run count; harder tiers carry more, and a boon past tier 1', () => {
    const c = hub().players[0]!.character;
    expect(trialMods(db(), c, 'foundry', 4)).toEqual(trialMods(db(), c, 'foundry', 4));
    for (let tier = 1; tier <= TRIAL_MAX; tier++) {
      const mods = trialMods(db(), c, 'roots', tier);
      const hard = mods.filter((m) => !db().trials[m]!.boon);
      const boons = mods.filter((m) => db().trials[m]!.boon);
      expect(hard.length).toBe(Math.min(4, 1 + Math.floor((tier - 1) / 3)));
      expect(boons.length).toBe(tier >= 2 ? 1 : 0);
      expect(new Set(mods).size).toBe(mods.length);
    }
  });

  it('raises the foes, remixes the waves the same way for the same seed, and lays the hardships on them', () => {
    const a = hub(true, 21);
    const b = hub(true, 21);
    // Tier 4 needs tier 3 behind it.
    for (const w of [a, b]) w.players[0]!.character.story['trial:ironwood'] = 3;
    expect(enter(a, 'ironwood', 4)).toBeNull();
    expect(enter(b, 'ironwood', 4)).toBeNull();
    const base = db().zones.ironwood!.nodes[0]!.level;
    expect(a.room.encounters[0]!.level).toBe(base + 8);
    expect(a.room.encounters.map((e) => e.waves)).toEqual(b.room.encounters.map((e) => e.waves));
    const authored = Object.values(db().rooms[a.room.id]!.encounters).map((e) => e.waves.flat().length);
    expect(a.room.encounters.map((e) => e.waves.flat().length).reduce((x, y) => x + y, 0)).toBeGreaterThan(authored.reduce((x, y) => x + y, 0));
    // Wake the first encounter and look at who answers.
    const p = a.entities.find((e) => e.kind === 'player')!;
    const enc = a.room.encounters[0]!;
    p.x = enc.x;
    p.z = enc.z + 2;
    tickN(a, 2);
    const foes = a.entities.filter((e) => e.kind === 'enemy');
    expect(foes.length).toBeGreaterThan(0);
    const elites = a.zone.mods.map((m) => db().trials[m]!.elite).filter(Boolean);
    for (const f of foes) for (const el of elites) expect(f.elite).toContain(el);
  });

  it('clearing the zone records the tier and opens the next', () => {
    const w = hub();
    enter(w, 'ironwood', 1);
    const last = db().zones.ironwood!.nodes.find((n) => n.onClear?.to?.startsWith('citadel'))!;
    w.transition = { to: last.id, at: w.tick };
    tickN(w, 1);
    expect(w.zone.node).toBe(last.id);
    expect(w.zone.trial).toBe(1);
    for (const e of w.entities) if (e.kind === 'enemy') e.dead = true;
    for (const enc of w.room.encounters) {
      enc.state = 'active';
      enc.wave = enc.waves.length - 1;
      enc.alive = [];
    }
    const ev = tickN(w, 400);
    expect(ev.some((e) => e.k === 'trial' && e.tier === 1)).toBe(true);
    expect(bestTier(w.players[0]!.character, 'ironwood')).toBe(1);
    expect(w.zone.id).toBe('citadel');
    expect(enter(w, 'ironwood', 2)).toBeNull();
  });

  it('rarity shifts move weight toward the rare end and keep the total', () => {
    const base = [55, 31, 11, 2.7, 0.3];
    const total = base.reduce((a, b) => a + b, 0);
    let prev = base;
    for (let s = 1; s <= 4; s++) {
      const w = shiftWeights(base, s);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
      expect(w[0]!).toBeLessThan(prev[0]!);
      expect(w[4]!).toBeGreaterThan(prev[4]!);
      prev = w;
    }
  });
});
