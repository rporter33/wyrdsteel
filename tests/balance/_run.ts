import { db } from '../unit/_db';
import { createWorld } from '../../src/core/sim/world';
import { step } from '../../src/core/sim/step';
import { botInput, newMemory, type Policy } from '../../src/core/bot/policies';
import { starterCharacter } from '../../src/core/loot/inventory';
import { generateItem } from '../../src/core/loot/generate';
import { applyCommand } from '../../src/core/sim/apply';
import { canRank, treeFor, allocFor, budgetFor } from '../../src/core/progression/skills';
import { XP_TABLE } from '../../src/core/progression/rewards';
import type { CharacterState } from '../../src/core/progression/character';
import type { SimEvent, World } from '../../src/core/sim/types';

/**
 * A character the way a player would arrive: at the zone's level, wearing found gear of that level,
 * with skill points spent down one path (the bot's "build").
 */
export function preparedCharacter(cls: string, level: number, align: 'human' | 'cyber' | null, seed = 1): CharacterState {
  const d = db();
  const c = starterCharacter(d, 'Bot', cls);
  c.level = level;
  c.xp = XP_TABLE[level]!;
  c.alignment = align;
  const weights = [0, 2, 5, 3, 0];
  const w = createWorld({ seed, players: [{ name: 'Bot', cls, character: c }], zone: 'training', node: 'training' }, d);
  const p = w.players[0]!;
  const melee = Object.values(d.bases).filter((b) => b.slot === 'melee' && d.classes[cls]!.melee.includes(b.kind) && b.ilvl <= level).pop()!;
  const ranged = Object.values(d.bases).filter((b) => b.slot === 'ranged' && d.classes[cls]!.ranged.includes(b.kind) && b.ilvl <= level).pop()!;
  const gear = [melee.id, ranged.id, ...['helm', 'chest', 'hands', 'legs'].map((s) => Object.values(d.bases).filter((b) => b.slot === s && b.ilvl <= level).pop()!.id)];
  gear.forEach((base, i) => {
    const it = generateItem(seed * 31 + i, { ilvl: level, cls, weights, base }, d);
    p.character.inv.push(it);
    applyCommand(w, 0, { t: 'equip', uid: it.uid }, d);
  });
  // Spend points greedily on the first nodes that accept them, class tree then aspect.
  for (const tree of ['cls', ...(align ? [align] : [])] as const) {
    const t = treeFor(d, p.character, tree);
    for (let guard = 0; guard < 60; guard++) {
      const node = t.nodes.find((n) => !canRank(t, allocFor(p.character, tree), n, budgetFor(p.character, tree), cls));
      if (!node) break;
      applyCommand(w, 0, { t: 'allocSkill', node: node.id, tree }, d);
    }
  }
  return structuredClone(p.character);
}

export interface ZoneRun {
  visited: string[];
  deaths: number;
  done: boolean;
  seconds: number;
  maxHitFrac: number;
  world: World;
}

export function runZone(character: CharacterState, zone: string, policy: Policy = 'tactical', seed = 9, maxMinutes = 20): ZoneRun {
  const d = db();
  const start = d.zones[zone]!.start;
  const w = createWorld({ seed, players: [{ name: 'Bot', cls: character.cls, character }], zone, node: start }, d);
  const mem = newMemory();
  let events: SimEvent[] = [];
  const visited: string[] = [];
  let deaths = 0;
  let maxHit = 0;
  let t = 0;
  for (; t < 60 * 60 * maxMinutes && w.zone.id === zone; t++) {
    step(w, { tick: w.tick, inputs: [botInput(w, d, 0, policy, mem, events)] }, d);
    events = w.events;
    for (const ev of events) if (ev.k === 'playerDown') deaths++;
    if (visited[visited.length - 1] !== w.zone.node) visited.push(w.zone.node);
    const pe = w.entities.find((e) => e.id === w.players[0]!.entity);
    if (pe?.pl) maxHit = Math.max(maxHit, pe.pl.maxHitFrac);
  }
  return { visited, deaths, done: w.zone.id !== zone, seconds: t / 60, maxHitFrac: maxHit, world: w };
}
