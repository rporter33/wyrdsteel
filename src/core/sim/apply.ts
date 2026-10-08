import type { ContentDb } from '../data/types';
import type { World } from './types';
import type { Command } from './commands';
import { byId } from './entity';
import { allocFor, budgetFor, canRank, respecCost, swapCost, treeFor, unlockedAbilities } from '../progression/skills';
import { refreshPlayer } from '../progression/rewards';
import { takeQuest } from '../progression/charms';
import { applyItemCommand } from '../loot/inventory';

/**
 * Menu actions applied between ticks. Each returns null on success or a reason it was refused;
 * a refused command changes nothing. Replays and co-op peers apply the same list in the same place.
 */
export function applyCommand(w: World, slot: number, cmd: Command, db: ContentDb): string | null {
  const p = w.players[slot];
  if (!p) return 'No such player';
  const c = p.character;
  switch (cmd.t) {
    case 'allocSkill': {
      if (cmd.tree !== 'cls' && cmd.tree !== c.alignment) return 'That aspect is not yours';
      const tree = treeFor(db, c, cmd.tree);
      const node = tree.nodes.find((n) => n.id === cmd.node);
      if (!node) return 'Unknown skill';
      const alloc = allocFor(c, cmd.tree);
      const why = canRank(tree, alloc, node, budgetFor(c, cmd.tree), c.cls);
      if (why) return why;
      alloc[node.id] = (alloc[node.id] ?? 0) + 1;
      // A newly unlocked ability goes into the first free slot.
      if (node.ability && c.abilities.length && !c.abilities.includes(node.ability)) {
        const free = c.abilities.indexOf('');
        if (free >= 0) c.abilities[free] = node.ability;
        else if (c.abilities.length < 4) c.abilities.push(node.ability);
      }
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'respec': {
      const cost = respecCost(c);
      if (c.bounty < cost) return `Needs ${cost} bounty`;
      c.bounty -= cost;
      c.skills.cls = {};
      if (c.alignment) c.skills.aspect[c.alignment] = {};
      c.skills.respecs++;
      c.abilities = [];
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'chooseAlignment': {
      if (c.alignment) return 'Already chosen';
      c.alignment = cmd.a;
      c.story['alignment'] = cmd.a === 'human' ? 1 : 2;
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'swapAspect': {
      if (!c.alignment) return 'No aspect chosen yet';
      const cost = swapCost(c);
      if (c.bounty < cost) return `Needs ${cost} bounty`;
      c.bounty -= cost;
      c.alignment = c.alignment === 'human' ? 'cyber' : 'human';
      c.skills.swaps++;
      // Abilities from the old aspect fall out of their slots.
      const ok = unlockedAbilities(c, db);
      c.abilities = c.abilities.map((a) => (ok.includes(a) ? a : ''));
      refreshPlayer(w, db, slot);
      return null;
    }
    case 'setAbility': {
      if (cmd.idx < 0 || cmd.idx > 3) return 'Bad slot';
      const ok = unlockedAbilities(c, db);
      if (cmd.ability && !ok.includes(cmd.ability)) return 'Not unlocked';
      if (!c.abilities.length) c.abilities = [...ok.slice(0, 4)];
      while (c.abilities.length < 4) c.abilities.push('');
      const prev = c.abilities.indexOf(cmd.ability);
      if (prev >= 0 && cmd.ability) c.abilities[prev] = c.abilities[cmd.idx]!;
      c.abilities[cmd.idx] = cmd.ability;
      const e = byId(w, p.entity);
      if (e?.pl) e.pl.cds = [0, 0, 0, 0];
      return null;
    }
    case 'takeQuest':
      return takeQuest(w, slot, cmd.charm, db);
    case 'story':
      c.story[cmd.key] = cmd.value;
      return null;
    case 'flask': {
      const e = byId(w, p.entity);
      if (e?.pl) e.pl.flasks = p.stats.flasks;
      return null;
    }
    default:
      return applyItemCommand(w, slot, cmd, db);
  }
}

export function applyCommands(w: World, slot: number, cmds: Command[], db: ContentDb): string[] {
  const errors: string[] = [];
  for (const c of cmds) {
    const r = applyCommand(w, slot, c, db);
    if (r) errors.push(r);
  }
  return errors;
}
