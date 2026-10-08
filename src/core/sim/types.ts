import type { RngState } from '../rng/xoshiro';
import type { PlayerInput } from '../input/frame';
import type { CharacterState } from '../progression/character';
import type { DerivedStats } from '../progression/stats';

export type EntityKind = 'player' | 'enemy' | 'projectile' | 'pickup' | 'hazard' | 'npc' | 'prop';

export const TEAM_PLAYERS = 0;
export const TEAM_ENEMIES = 1;
export const TEAM_NEUTRAL = 2;

/** Index into Status.b and the status tables. */
export const ST_ROOT = 0;
export const ST_CHILL = 1;
export const ST_BURN = 2;
export const ST_SHOCK = 3;
export type StatusId = 'root' | 'chill' | 'burn' | 'shock';
export const STATUS_IDS: StatusId[] = ['root', 'chill', 'burn', 'shock'];

export interface Status {
  /** Build-up toward each status, 0..100. */
  b: number[];
  root: number;
  chill: number;
  freeze: number;
  burn: number;
  burnDmg: number;
  shock: number;
  /** Crowd-control resistance 0..1: rises on each application, decays over time. */
  ccRes: number;
}

export interface Act {
  id: string;
  t: number;
  /** Anchor for target-placed hits (ground circles, eruptions): fixed when the action starts. */
  ax: number;
  az: number;
  /** Entities already hit by each hit window, so one swing hits a target once. */
  hit: number[];
  node: string;
  dx: number;
  dz: number;
  target: number;
  /** Lunge distance already travelled. */
  moved: number;
}

export interface PlayerComp {
  slot: number;
  dodges: number;
  dodgeAt: number;
  /** Tick until which a perfect-dodge empowerment is active. */
  empowered: number;
  flasks: number;
  buffer: { input: 'light' | 'heavy' | 'launcher'; at: number } | null;
  /** Last combo node and the tick until which the next press continues the string. */
  chain: string;
  chainUntil: number;
  /** Buff ticks remaining and amount (Howl, empowered). */
  buffDmg: number;
  buffUntil: number;
  /** Damage dealt recently, for the training-yard readout. */
  dealt: number;
  lock: number;
  soft: number;
  fireCd: number;
  cds: number[];
  ruin: number;
  /** Most recent dodge start, for perfect-dodge detection. */
  lastDodge: number;
  respawnAt: number;
  downed: boolean;
  /** Observations the adaptive boss reads: ticks spent close, ticks far, dodges. */
  obsNear: number;
  obsFar: number;
  obsDodge: number;
  dmgTaken: number;
  maxHitFrac: number;
}

export interface AiComp {
  st: string;
  t: number;
  target: number;
  /** Attack token held: 0 none, 1 melee, 2 ranged, 3 heavy. */
  token: number;
  /** Cooldown per attack in the enemy's attack list, plus a global recovery. */
  cds: number[];
  gcd: number;
  homeX: number;
  homeZ: number;
  aggro: boolean;
  /** Scratch registers some archetypes use (tether target, burrow timer, fuse). */
  a: number;
  b: number;
  c: number;
  enc: number;
  /** Partner for the Linked elite affix. */
  link: number;
  /** Strafe direction while waiting for a token: 1 or -1. */
  side: number;
}

/** An attacker's rolled damage and bonuses, captured when a blow or shot starts. */
export interface Profile {
  base: number;
  pct: number;
  critChance: number;
  critMult: number;
  poiseMult: number;
  statusPct: number;
  lifesteal: number;
  level: number;
  onHit: { k: StatusId; amt: number }[];
  weakPct: number;
  airPct: number;
  ruinGain: number;
}

export interface ProjComp {
  owner: number;
  prof: Profile;
  dmg: number;
  poise: number;
  life: number;
  pierce: number;
  hit: number[];
  status: { k: StatusId; amt: number } | null;
  homing: number;
  aoe: number;
  launch: number;
  stop: number;
  /** 1 when fired by a player with a weak-point-seeking modifier. */
  crit: number;
  arc: number;
}

export interface PickupComp {
  kind: 'item' | 'bounty' | 'rune' | 'mat' | 'shade' | 'heal';
  owner: number;
  ref: string;
  amount: number;
  item: import('../loot/item').Item | null;
}

export interface PartState {
  id: string;
  hp: number;
  hpMax: number;
  broken: boolean;
}

export interface BossComp {
  phase: number;
  pattern: string;
  history: string[];
  invuln: number;
  heat: number;
  exposed: number;
  plating: number;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  def: string;
  team: number;
  level: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  px: number;
  pz: number;
  py: number;
  fx: number;
  fz: number;
  r: number;
  h: number;
  hp: number;
  hpMax: number;
  poise: number;
  poiseMax: number;
  poiseAt: number;
  act: Act | null;
  stun: number;
  /** 0 none, 1 stagger, 2 knockdown, 3 frozen. */
  stunKind: number;
  hitstop: number;
  iframes: number;
  armorT: number;
  juggle: number;
  status: Status;
  dead: boolean;
  removeAt: number;
  shield: number;
  /** Tick of the last hit taken, for hit flash and poise regen. */
  hurtAt: number;
  /** Entity that last damaged this one (credited with the kill). */
  lastHit: number;
  /** How the last hit landed, for charm quests (air, behind, status, weak point, ranged). */
  lastHow: number;
  pl?: PlayerComp;
  ai?: AiComp;
  proj?: ProjComp;
  pick?: PickupComp;
  /** Deployed turret: owner player entity, ticks left, shot cooldown. */
  tur?: { owner: number; life: number; cd: number };
  parts?: PartState[];
  elite?: string[];
  boss?: BossComp;
}

export interface PlayerSlot {
  slot: number;
  entity: number;
  character: CharacterState;
  /** Derived from character; refreshed whenever gear, skills or level change. */
  stats: DerivedStats;
  /** 0..1 strength of melee/ranged aim assist. */
  assist: number;
  lastInput: PlayerInput;
}

export interface RoomState {
  id: string;
  variant: number;
  w: number;
  h: number;
  /** Row-major tile codes; see level/grid.ts. */
  tiles: number[];
  /** Bumped whenever a tile changes (cracked ice), so derived caches rebuild. */
  ver: number;
  /** Entrance point ('P' marker). */
  spawnX: number;
  spawnZ: number;
  /** Tick-varying hazard state per room feature (vents, geysers, braziers). */
  features: Feature[];
  encounters: EncounterState[];
  cleared: boolean;
  exits: Exit[];
  /** Blizzard / surge state: tick it starts, tick it ends. */
  surgeAt: number;
  surgeEnd: number;
  rule: string;
}

export interface Feature {
  kind: 'brazier' | 'vent' | 'geyser' | 'waystone' | 'generator' | 'conveyor' | 'npc' | 'shrine' | 'chest' | 'crack';
  x: number;
  z: number;
  /** Phase/timer/on-off/health, depending on kind. */
  a: number;
  b: number;
  id: string;
  dir: number;
}

export interface EncounterState {
  id: number;
  x: number;
  z: number;
  radius: number;
  state: 'idle' | 'active' | 'done';
  waves: string[][];
  wave: number;
  alive: number[];
  elite: string[];
  level: number;
}

export interface Exit {
  x: number;
  z: number;
  to: string;
  open: boolean;
  label: string;
}

export interface Valk {
  slot: number;
  at: number;
}

export interface World {
  v: 1;
  tick: number;
  seed: number;
  rng: { combat: RngState; ai: RngState; level: RngState; loot: RngState[] };
  entities: Entity[];
  nextId: number;
  players: PlayerSlot[];
  room: RoomState;
  zone: ZoneRuntime;
  difficulty: 0 | 1 | 2;
  flags: Record<string, number>;
  events: SimEvent[];
  /** The shared stash (profile-wide), carried in the world so stash moves replay like any command. */
  stash: import('../loot/item').Item[];
  /** Pending room transition requested by an exit; applied by the session between ticks. */
  transition: { to: string; at: number } | null;
}

export interface ZoneRuntime {
  id: string;
  /** Rooms cleared in this zone, by room node id. Cleared rooms do not respawn after a death. */
  cleared: string[];
  node: string;
  waystone: string;
  /** Bounty earned since the last waystone; the Valkyrie's toll is a share of this. */
  sinceWaystone: number;
  shade: { node: string; x: number; z: number; amount: number } | null;
  mods: string[];
  trial: number;
}

export type SimEvent =
  | { k: 'hit'; t: number; src: number; dst: number; dmg: number; crit: boolean; weak: boolean; x: number; y: number; z: number; heavy: boolean; status?: StatusId }
  | { k: 'swing'; t: number; src: number; action: string }
  | { k: 'shoot'; t: number; src: number; weapon: string }
  | { k: 'dodge'; t: number; src: number; perfect: boolean }
  | { k: 'death'; t: number; src: number; def: string; x: number; z: number; killer: number }
  | { k: 'status'; t: number; dst: number; status: StatusId | 'freeze' }
  | { k: 'stagger'; t: number; dst: number; down: boolean }
  | { k: 'launch'; t: number; dst: number }
  | { k: 'land'; t: number; dst: number; slam: boolean }
  | { k: 'partBreak'; t: number; dst: number; part: string }
  | { k: 'telegraph'; t: number; src: number; shape: 'circle' | 'line' | 'ring' | 'cone'; x: number; z: number; r: number; dx: number; dz: number; len: number; width: number; dur: number }
  | { k: 'pickup'; t: number; slot: number; kind: string; ref: string; amount: number; rarity?: string; name?: string }
  | { k: 'drop'; t: number; id: number; rarity: string }
  | { k: 'levelUp'; t: number; slot: number; level: number }
  | { k: 'playerDown'; t: number; slot: number }
  | { k: 'respawn'; t: number; slot: number }
  | { k: 'waystone'; t: number; slot: number; id: string }
  | { k: 'encounter'; t: number; id: number; state: 'start' | 'wave' | 'done' }
  | { k: 'quest'; t: number; slot: number; charm: string; done: boolean }
  | { k: 'ruiner'; t: number; src: number; id: string }
  | { k: 'ability'; t: number; src: number; id: string }
  | { k: 'boss'; t: number; what: 'phase' | 'pattern' | 'exposed' | 'plated' | 'defeated'; value: string }
  | { k: 'hazard'; t: number; what: string; x: number; z: number }
  | { k: 'surge'; t: number; on: boolean; warn: boolean }
  | { k: 'interact'; t: number; slot: number; what: string; id: string }
  | { k: 'exit'; t: number; to: string }
  | { k: 'shatter'; t: number; dst: number }
  | { k: 'finisher'; t: number; src: number; dst: number };
