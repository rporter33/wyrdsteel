import type { ContentDb, SkillNodeDef, TreeDef } from '../data/types';
import type { CharacterState, Alignment } from './character';
import { applyStat, type DerivedStats } from './stats';

/** Ranks needed in a path before its capstone row opens. */
export const CAPSTONE_POINTS = 10;
export const CAPSTONE_ROW = 5;
/** Aspect points start this many levels in: about when the story offers the choice. */
export const ASPECT_START = 4;

export function classPoints(c: CharacterState): number {
  return c.level - 1 + c.charms.filter((x) => x.done).length;
}

export function aspectPoints(c: CharacterState): number {
  return c.alignment ? Math.max(1, c.level - ASPECT_START) : 0;
}

export function spent(alloc: Record<string, number>): number {
  let n = 0;
  for (const k of Object.keys(alloc)) n += alloc[k]!;
  return n;
}

export function pathSpent(tree: TreeDef, alloc: Record<string, number>, path: number): number {
  let n = 0;
  for (const node of tree.nodes) if (node.path === path) n += alloc[node.id] ?? 0;
  return n;
}

export interface Violation {
  node: string;
  why: string;
}

/** Can one more rank go into `node`? Returns the reason it cannot, or null. */
export function canRank(tree: TreeDef, alloc: Record<string, number>, node: SkillNodeDef, budget: number, cls: string): string | null {
  const cur = alloc[node.id] ?? 0;
  if (cur >= node.maxRank) return 'Maxed';
  if (spent(alloc) >= budget) return 'No points';
  for (const r of node.requires) if (!(alloc[r] ?? 0)) return `Needs ${tree.nodes.find((n) => n.id === r)?.name ?? r}`;
  if (node.row >= CAPSTONE_ROW && pathSpent(tree, alloc, node.path) < CAPSTONE_POINTS) return `Needs ${CAPSTONE_POINTS} points in ${tree.paths[node.path]}`;
  if (node.cls && node.cls !== cls) return 'Other class';
  return null;
}

/** Every rule an allocation must satisfy; empty means valid. Used on load and in tests. */
export function validateAllocation(tree: TreeDef, alloc: Record<string, number>, budget: number, cls: string): Violation[] {
  const out: Violation[] = [];
  if (spent(alloc) > budget) out.push({ node: '*', why: 'over budget' });
  for (const [id, rank] of Object.entries(alloc)) {
    const node = tree.nodes.find((n) => n.id === id);
    if (!node) {
      out.push({ node: id, why: 'unknown node' });
      continue;
    }
    if (rank < 0 || rank > node.maxRank) out.push({ node: id, why: 'bad rank' });
    if (rank > 0) {
      for (const r of node.requires) if (!(alloc[r] ?? 0)) out.push({ node: id, why: `requires ${r}` });
      if (node.row >= CAPSTONE_ROW && pathSpent(tree, alloc, node.path) - rank < CAPSTONE_POINTS) out.push({ node: id, why: 'capstone gate' });
      if (node.cls && node.cls !== cls) out.push({ node: id, why: 'class-locked' });
    }
  }
  return out;
}

export function treeFor(db: ContentDb, c: CharacterState, which: 'cls' | Alignment): TreeDef {
  return which === 'cls' ? db.classes[c.cls]!.tree : db.alignTrees[which];
}

export function allocFor(c: CharacterState, which: 'cls' | Alignment): Record<string, number> {
  return which === 'cls' ? c.skills.cls : c.skills.aspect[which];
}

export function budgetFor(c: CharacterState, which: 'cls' | Alignment): number {
  return which === 'cls' ? classPoints(c) : aspectPoints(c);
}

/** Respec costs nothing through level 10 and the first time; then rises 50% a time, capped. */
export function respecCost(c: CharacterState): number {
  if (c.level <= 10 || c.skills.respecs === 0) return 0;
  return Math.min(2500, Math.round(40 * c.level * (1 + 0.5 * (c.skills.respecs - 1))));
}

/** Swapping aspect: the first swap is free; later ones cost more, less 100 per Wyrd sigil. */
export function swapCost(c: CharacterState): number {
  if (c.skills.swaps === 0) return 0;
  return Math.max(0, Math.min(1500, 300 * c.skills.swaps) - 100 * c.sigils);
}

/** Skill effects into derived stats: the class tree, then the active aspect's tree. */
export function applySkills(c: CharacterState, db: ContentDb, s: DerivedStats): void {
  const add = (tree: TreeDef, alloc: Record<string, number>) => {
    for (const node of tree.nodes) {
      const r = alloc[node.id] ?? 0;
      if (!r) continue;
      for (const ef of node.effects) applyStat(s, ef.stat, ef.amt * r);
    }
  };
  const cls = db.classes[c.cls];
  if (cls) add(cls.tree, c.skills.cls);
  if (c.alignment) add(db.alignTrees[c.alignment], c.skills.aspect[c.alignment]);
}

/** Abilities a character has unlocked: class abilities in class order, then the aspect's. */
export function unlockedAbilities(c: CharacterState, db: ContentDb): string[] {
  const ranked = (id: string) => (c.skills.cls[id] ?? 0) > 0 || (c.alignment ? (c.skills.aspect[c.alignment][id] ?? 0) > 0 : false);
  const cls = db.classes[c.cls];
  const order = [...(cls?.abilities ?? []), ...Object.values(db.abilities).filter((a) => a.cls === c.alignment).map((a) => a.id)];
  return order.filter((id) => {
    const a = db.abilities[id];
    if (!a) return false;
    if (a.cls === 'human' || a.cls === 'cyber') {
      if (a.cls !== c.alignment) return false;
    } else if (a.cls !== c.cls) return false;
    return !a.unlock || ranked(a.unlock);
  });
}
