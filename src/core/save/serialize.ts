import type { World } from '../sim/types';
import type { StartSpec } from '../sim/world';
import type { CharacterSave } from './schema';

/** Snapshot the local player's progress at a save point. Mid-fight sim state is never saved. */
export function characterSave(w: World, slot: number, saveSlot: number, playMs: number, savedAt: string): CharacterSave {
  const p = w.players[slot]!;
  return {
    slot: saveSlot,
    character: structuredClone(p.character),
    zone: {
      id: w.zone.id,
      node: w.zone.waystone,
      cleared: [...w.zone.cleared],
      shade: w.zone.shade ? { ...w.zone.shade } : null,
      mods: [...w.zone.mods],
      trial: w.zone.trial,
    },
    difficulty: w.difficulty,
    seed: w.seed,
    playMs,
    savedAt,
  };
}

/** Where a loaded character starts: at their last waystone, with cleared rooms kept. */
export function startFrom(cs: CharacterSave, stash: StartSpec['stash'], seed: number): StartSpec {
  return {
    seed,
    players: [{ name: cs.character.name, cls: cs.character.cls, character: structuredClone(cs.character) }],
    zone: cs.zone.id,
    node: cs.zone.node,
    cleared: [...cs.zone.cleared],
    difficulty: cs.difficulty,
    mods: [...cs.zone.mods],
    trial: cs.zone.trial,
    stash,
    shade: cs.zone.shade,
  };
}
