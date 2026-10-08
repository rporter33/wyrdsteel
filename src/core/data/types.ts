// Content as the sim sees it after loading. Authored packs give times in milliseconds and angles
// in degrees; load.ts converts them to ticks and cosines once, so the sim never does either.
import type { StatusId } from '../sim/types';
import type { GearSlot, Rarity } from '../loot/item';

export type ComboInput = 'light' | 'heavy' | 'launcher';

export interface HitDef {
  from: number;
  to: number;
  shape: 'sector' | 'circle' | 'line';
  range: number;
  /** cos of the half-angle for sectors. */
  cosArc: number;
  /** The half-angle itself, radians: telegraphs draw the true sector. */
  arc: number;
  width: number;
  /** Forward offset of a circle's centre. */
  offset: number;
  yMin: number;
  yMax: number;
  dmg: number;
  poise: number;
  launch: number;
  knock: number;
  down: boolean;
  stop: number;
  status: { k: StatusId; amt: number } | null;
  guardBreak: boolean;
  tag: 'light' | 'heavy' | 'launcher' | 'air' | 'ability' | 'ruiner' | 'finisher' | 'enemy';
  /** Fraction of the target's max HP one hit may deal to a player. */
  cap: number;
  /** Circle centred on the attacker ('self') or on the point targeted at action start ('target'). */
  at: 'self' | 'target';
}

export interface ActionDef {
  id: string;
  /** Render-only: which pose family animates this action. */
  pose: string;
  len: number;
  move: number;
  turn: number;
  lunge: { from: number; to: number; dist: number } | null;
  hits: HitDef[];
  cancel: number;
  armor: [number, number] | null;
  iframes: [number, number] | null;
  /** Launcher follow: the attacker jumps with the target if the button is still held. */
  jump: { at: number; vy: number; ifHeld: boolean } | null;
  air: boolean;
  hover: number;
  shoot: { at: number[]; proj: string; count: number; spreadCos: number; spreadSin: number; dmg: number } | null;
  slam: boolean;
  /** Telegraph shown from action start until the first hit window, for enemy attacks. */
  tele: { shape: 'circle' | 'line' | 'ring' | 'cone'; r: number; width: number; at?: 'target' } | null;
  /** Dash to a point (enemy charges, player gap closers): distance over the window. */
  dash: { from: number; to: number; dist: number } | null;
  buff: { stat: string; amt: number; dur: number } | null;
  spawn: { at: number; def: string; count: number } | null;
  heal: number;
}

export interface ComboNode {
  id: string;
  input: ComboInput;
  /** Node ids this follows; '' is grounded neutral, '@air' is airborne neutral. */
  from: string[];
  action: string;
}

export interface WeaponKindDef {
  id: string;
  name: string;
  hand: 'melee' | 'ranged';
  classes: string[];
  /** Melee: combo graph. Ranged: fire action and cadence. */
  combo: ComboNode[];
  fire: { proj: string; interval: number; count: number; spreadCos: number; spreadSin: number; auto: boolean; moveMult: number; range: number } | null;
  dmg: [number, number];
  speed: number;
}

export interface ProjectileDef {
  id: string;
  speed: number;
  radius: number;
  life: number;
  pierce: number;
  gravity: number;
  homing: number;
  aoe: number;
  status: { k: StatusId; amt: number } | null;
  poise: number;
  launch: number;
  stop: number;
  color: string;
  /** Shootable (enemy shards can be shot down). */
  fragile: boolean;
  /** Stationary shots that go off when a hostile steps close (mines). */
  trigger: boolean;
}

export interface AbilityDef {
  id: string;
  name: string;
  cls: string;
  cd: number;
  action: string;
  desc: string;
  /** Skill node that unlocks it; null = starts unlocked. */
  unlock: string | null;
}

export interface ClassDef {
  id: string;
  name: string;
  blurb: string;
  hp: number;
  hpPerLevel: number;
  speed: number;
  armor: number;
  melee: string[];
  ranged: string[];
  startMelee: string;
  startRanged: string;
  abilities: string[];
  tree: TreeDef;
  dodge: string;
}

export interface SkillEffect {
  stat: string;
  /** Per rank. */
  amt: number;
}

export interface SkillNodeDef {
  id: string;
  name: string;
  path: number;
  row: number;
  maxRank: number;
  requires: string[];
  effects: SkillEffect[];
  ability: string | null;
  desc: string;
  /** Class-locked nodes (aspect capstones) only rank for this class. */
  cls: string | null;
}

export interface TreeDef {
  id: string;
  paths: string[];
  nodes: SkillNodeDef[];
}

export interface PartDef {
  id: string;
  name: string;
  hp: number;
  /** Offset in the body's local frame: forward and right, metres. */
  fwd: number;
  right: number;
  y: number;
  r: number;
  /** Damage multiplier when hit here. */
  weak: number;
  /** What breaking it does: 'kneel' (legs), 'noThrow' (arms), 'expose'. */
  effect: string;
}

export interface AttackDef {
  action: string;
  /** Distance band this attack is chosen in. */
  min: number;
  max: number;
  /** Cooldown, ticks. */
  cd: number;
  kind: 'melee' | 'ranged' | 'heavy';
  weight: number;
  /** Disabled once this part is broken (a troll with a broken arm stops throwing). */
  needsPart: string | null;
}

export interface EnemyDef {
  id: string;
  name: string;
  brain: string;
  hp: number;
  hpPerLevel: number;
  dmg: number;
  dmgPerLevel: number;
  armor: number;
  speed: number;
  radius: number;
  height: number;
  poise: number;
  weight: 'light' | 'medium' | 'heavy';
  xp: number;
  bounty: number;
  attacks: AttackDef[];
  /** Preferred fighting distance band. */
  range: number;
  keep: [number, number];
  aggro: number;
  /** 'front' = blocks light melee and projectiles from the front. */
  guard: 'none' | 'front';
  parts: PartDef[];
  resist: Partial<Record<StatusId, number>>;
  drop: string;
  color: string;
  model: string;
}

export interface EliteDef {
  id: string;
  name: string;
  desc: string;
  hpMult: number;
  dmgMult: number;
}

export interface AffixDef {
  id: string;
  name: string;
  kind: 'prefix' | 'suffix';
  group: string;
  tier: number;
  ilvl: number;
  weight: number;
  slots: GearSlot[];
  classes: string[] | null;
  stat: string;
  range: [number, number];
}

export interface BaseItemDef {
  id: string;
  name: string;
  slot: GearSlot;
  kind: string;
  ilvl: number;
  classes: string[] | null;
  armor: number;
  /** Charms: the ruiner they grant. */
  ruiner: string | null;
}

export interface UniqueDef {
  id: string;
  name: string;
  slot: GearSlot;
  stats: SkillEffect[];
  desc: string;
}

export interface RuneDef {
  id: string;
  name: string;
  tier: number;
  stats: SkillEffect[];
  onHit: { k: StatusId; amt: number } | null;
}

export interface CharmDef {
  id: string;
  name: string;
  ruiner: string;
  desc: string;
  quests: { kind: 'kill' | 'killAir' | 'killBehind' | 'killStatus' | 'killWeak' | 'killRanged'; target: string; count: number; text: string }[];
}

export interface RuinerDef {
  id: string;
  name: string;
  action: string;
  desc: string;
}

export interface BlueprintDef {
  id: string;
  name: string;
  base: string;
  rarity: Rarity;
  guaranteed: string[];
  bounty: number;
  mats: Record<string, number>;
}

export interface DropTableDef {
  id: string;
  /** Chance per kill that any item drops. */
  itemChance: number;
  bounty: [number, number];
  runeChance: number;
  matChance: number;
  rarityWeights: number[];
}

export interface RoomDef {
  id: string;
  name: string;
  variants: string[][];
  /** Wave composition by encounter marker digit: '1' -> list of waves of enemy ids. */
  encounters: Record<string, { waves: string[][]; elite?: string[] }>;
  rule: string;
  music: string;
  ambient: string;
  surge: boolean;
  /** Fixed spawns by marker glyph (training dummies), not part of any encounter. */
  statics?: Record<string, string>;
  palette?: string;
}

export interface ZoneNodeDef {
  id: string;
  room: string;
  /** Exits in reading order of the room's 'D' markers. "zone:node" leaves the zone. */
  next: string[];
  level: number;
  /** Story beat played the first time the room is entered. */
  story?: string;
  /** When the room is cleared: set story flags, play a beat, optionally send everyone somewhere. */
  onClear?: { flags?: Record<string, number>; story?: string; to?: string; sigil?: boolean; delayMs?: number };
  /** Alignment-specific routing. */
  align: 'human' | 'cyber' | null;
  optional: boolean;
}

export interface ZoneDef {
  id: string;
  name: string;
  desc: string;
  start: string;
  /** Story flag that must be set before the gate offers this zone. */
  requires?: string;
  /** Shown at the gate. */
  travel?: boolean;
  level: [number, number];
  nodes: ZoneNodeDef[];
  palette: string;
  next: string | null;
}

export interface DialogueLine {
  who: string;
  text: string;
  human?: string;
  cyber?: string;
}

export interface StoryBeat {
  id: string;
  lines: DialogueLine[];
  choice?: { label: string; set: string; value: number; desc: string }[];
}

export interface CodexEntry {
  id: string;
  title: string;
  text: string;
  /** "beat:x", "kill:enemy", or a story flag. */
  unlock: string;
}

export interface WyrdRuleDef {
  id: string;
  name: string;
  desc: string;
}

/** One of a boss's patterns: a string of actions, the reads it answers, and when it may run. */
export interface BossPatternDef {
  id: string;
  actions: string[];
  /** The player habits this pattern punishes: close, mid, far, dodgy. */
  vs: string[];
  phases: number[];
  /** Distance band the first action starts from; the boss walks into it first. */
  min: number;
  max: number;
}

export interface BossDef {
  /** The enemy id this applies to. */
  id: string;
  title: string;
  /** Enemy id of the guardian that restores plating (empty for none). */
  guardian: string;
  /** HP fractions where phases 1 and 2 end. */
  phases: number[];
  /** Plating as a fraction of max HP, and how much of a blow gets through it. */
  plating: number;
  bleed: number;
  /** Stone hide: share of ranged damage taken while the heart is covered. */
  rangedTaken: number;
  /** Ticks: between re-plating channels, channel length, invulnerable transition, exposed heart. */
  replate: number;
  channel: number;
  transition: number;
  exposed: number;
  /** Phase 2+: patterns between overheats. */
  overheat: number;
  /** Observation span, ticks: how long the boss watches before settling on a read. */
  span: number;
  patterns: BossPatternDef[];
  /** The last phase's fixed, learnable sequence ('overheat' vents). */
  final: string[];
  /** Arena radii after each collapse; the second comes at half the last phase. */
  arena: number[];
  /** Lines the boss speaks: phase:2, phase:3, read:far, defeated... */
  lines: Record<string, string>;
}

/** A Wyrd Trial modifier: a hardship (or a boon) laid over a zone remix. */
export interface TrialModDef {
  id: string;
  name: string;
  desc: string;
  /** Elite affix given to every foe. */
  elite?: string;
  hpMult?: number;
  dmgMult?: number;
  /** Extra foes per wave. */
  extra?: number;
  flaskMult?: number;
  bountyMult?: number;
  /** Extra steps of rarity shift on drops. */
  rarity?: number;
  boon?: boolean;
}

export interface ContentDb {
  version: number;
  hash: string;
  actions: Record<string, ActionDef>;
  weapons: Record<string, WeaponKindDef>;
  projectiles: Record<string, ProjectileDef>;
  abilities: Record<string, AbilityDef>;
  classes: Record<string, ClassDef>;
  alignTrees: Record<'human' | 'cyber', TreeDef>;
  enemies: Record<string, EnemyDef>;
  elites: Record<string, EliteDef>;
  affixes: AffixDef[];
  bases: Record<string, BaseItemDef>;
  runes: Record<string, RuneDef>;
  charms: Record<string, CharmDef>;
  ruiners: Record<string, RuinerDef>;
  blueprints: Record<string, BlueprintDef>;
  drops: Record<string, DropTableDef>;
  rooms: Record<string, RoomDef>;
  zones: Record<string, ZoneDef>;
  story: Record<string, StoryBeat>;
  wyrd: Record<string, WyrdRuleDef>;
  uniques: Record<string, UniqueDef>;
  codex: CodexEntry[];
  bosses: Record<string, BossDef>;
  trials: Record<string, TrialModDef>;
}
