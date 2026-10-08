import type { ContentDb } from '../data/types';
import { deriveSeed, seedRng, nextInt } from '../rng/xoshiro';
import { emptyInput } from '../input/frame';
import { type CharacterState } from '../progression/character';
import { starterCharacter } from '../loot/inventory';
import { computeStats } from '../progression/derive';
import { buildRoom, markersOf } from '../level/room';
import { newEntity } from './entity';
import { spawnEnemy } from './spawn';
import { placeShade } from './systems/players';
import { MAX_PLAYERS } from './constants';
import { TEAM_PLAYERS, type Entity, type Feature, type PlayerSlot, type RoomState, type World } from './types';

export interface StartSpec {
  seed: number;
  players: { name: string; cls: string; character?: CharacterState }[];
  zone: string;
  node: string;
  difficulty?: 0 | 1 | 2;
  cleared?: string[];
  mods?: string[];
  trial?: number;
  stash?: import('../loot/item').Item[];
  shade?: { node: string; x: number; z: number; amount: number } | null;
}

export function createWorld(spec: StartSpec, db: ContentDb): World {
  const seed = spec.seed >>> 0;
  const w: World = {
    v: 1,
    tick: 0,
    seed,
    rng: {
      combat: seedRng(deriveSeed(seed, 'combat')),
      ai: seedRng(deriveSeed(seed, 'ai')),
      level: seedRng(deriveSeed(seed, 'level')),
      loot: Array.from({ length: MAX_PLAYERS }, (_, i) => seedRng(deriveSeed(seed, `loot:${i}`))),
    },
    entities: [],
    nextId: 1,
    players: [],
    room: emptyRoom(),
    zone: {
      id: spec.zone,
      cleared: spec.cleared ? [...spec.cleared] : [],
      node: spec.node,
      waystone: spec.node,
      sinceWaystone: 0,
      shade: spec.shade ? { ...spec.shade } : null,
      mods: spec.mods ?? [],
      trial: spec.trial ?? 0,
    },
    difficulty: spec.difficulty ?? 1,
    flags: {},
    events: [],
    stash: spec.stash ? spec.stash.map((i) => ({ ...i })) : [],
    transition: null,
  };
  spec.players.forEach((p, slot) => {
    // Clone: the world owns its state. A shared object would let a run rewrite its own start spec,
    // and a replay of that spec would then begin from the end.
    const character = p.character ? structuredClone(p.character) : starterCharacter(db, p.name, p.cls);
    const ps: PlayerSlot = {
      slot,
      entity: 0,
      character,
      stats: computeStats(character, db),
      assist: 0.7,
      lastInput: emptyInput(),
    };
    w.players.push(ps);
  });
  enterNode(w, db, spec.node);
  return w;
}

function emptyRoom(): RoomState {
  return { id: '', variant: 0, w: 1, h: 1, tiles: [3], ver: 0, spawnX: 0, spawnZ: 0, features: [], encounters: [], cleared: false, exits: [], surgeAt: -1, surgeEnd: -1, rule: '' };
}

/** Resolve a zone node to its room. Training and hub rooms can be entered by room id directly. */
export function nodeRoom(db: ContentDb, zoneId: string, nodeId: string): { room: string; level: number } {
  const zone = db.zones[zoneId];
  const node = zone?.nodes.find((n) => n.id === nodeId);
  if (node) return { room: node.room, level: node.level };
  return { room: nodeId, level: 1 };
}

/**
 * Replace the world's room with a zone node: rebuild tiles, features and encounters, and put the
 * players at the entrance. Non-player entities are dropped; ids keep counting up.
 */
export function enterNode(w: World, db: ContentDb, nodeId: string, fromExit?: string): void {
  const { room: roomId, level } = nodeRoom(db, w.zone.id, nodeId);
  const def = db.rooms[roomId]!;
  const variant = nextInt(w.rng.level, def.variants.length);
  const built = buildRoom(db, roomId, variant);
  const cleared = w.zone.cleared.includes(nodeId);
  w.zone.node = nodeId;
  const room: RoomState = {
    id: roomId,
    variant,
    w: built.grid.w,
    h: built.grid.h,
    tiles: built.grid.tiles,
    ver: 0,
    spawnX: 0,
    spawnZ: 0,
    features: [],
    encounters: [],
    cleared,
    exits: [],
    surgeAt: def.surge ? w.tick + 600 : -1,
    surgeEnd: -1,
    rule: def.rule,
  };
  const feature = (kind: Feature['kind'], x: number, z: number, id = '', a = 0, b = 0, dir = 0) =>
    room.features.push({ kind, x, z, a, b, id, dir });
  for (const m of built.markers) {
    switch (m.c) {
      case 'B':
        feature('brazier', m.x, m.z, '', 0);
        break;
      case 'V':
        feature('vent', m.x, m.z, '', 0, 0);
        break;
      case 'G':
        feature('geyser', m.x, m.z, '', 0, 0);
        break;
      case 'W':
        feature('waystone', m.x, m.z, nodeId);
        break;
      case 'S':
        feature('generator', m.x, m.z, '', 400);
        break;
      case '>':
      case '<':
      case '^':
      case 'v':
        feature('conveyor', m.x, m.z, '', 0, 0, '>v<^'.indexOf(m.c));
        break;
      case 'C':
        feature('chest', m.x, m.z, `${nodeId}:${m.x}:${m.z}`, cleared ? 1 : 0);
        break;
      case 'R':
        feature('shrine', m.x, m.z, nodeId);
        break;
      case 'k':
        feature('crack', m.x, m.z, '', 0);
        break;
      default:
        if (m.c >= 'a' && m.c <= 'h') feature('npc', m.x, m.z, npcFor(m.c));
    }
  }
  for (const m of built.markers) {
    if (m.c >= '1' && m.c <= '9') {
      const enc = def.encounters[m.c];
      if (!enc) continue;
      room.encounters.push({
        id: room.encounters.length,
        x: m.x,
        z: m.z,
        radius: 7,
        state: cleared ? 'done' : 'idle',
        waves: enc.waves,
        wave: 0,
        alive: [],
        elite: enc.elite ?? [],
        level,
      });
    }
  }
  w.room = room;
  w.entities = w.entities.filter((e) => e.kind === 'player');
  if (def.statics) {
    for (const m of built.markers) {
      const id = def.statics[m.c];
      if (id) {
        const s = spawnEnemy(w, db, id, m.x, m.z, level, []);
        s.ai!.st = 'static';
      }
    }
  }
  const zone = db.zones[w.zone.id];
  const node = zone?.nodes.find((n) => n.id === nodeId);
  const exits = markersOf(built, 'D');
  const nexts = node ? node.next : [];
  exits.forEach((m, i) => {
    const to = nexts[i] ?? '';
    room.exits.push({ x: m.x, z: m.z, to, open: room.encounters.every((e) => e.state === 'done'), label: to ? (zone?.nodes.find((n) => n.id === to)?.room ?? to) : '' });
  });
  w.room = room;
  const starts = markersOf(built, 'P');
  const entryIdx = fromExit ? Math.max(0, starts.findIndex(() => true)) : 0;
  const start = starts[entryIdx] ?? { x: room.w / 2, z: room.h / 2 };
  room.spawnX = start.x;
  room.spawnZ = start.z;
  w.players.forEach((p, i) => {
    let e = w.entities.find((x) => x.id === p.entity);
    if (!e) e = spawnPlayer(w, p);
    const ox = (i % 2) * 1.2 - 0.6 * (w.players.length > 1 ? 1 : 0);
    const oz = Math.floor(i / 2) * 1.2;
    e.x = e.px = start.x + ox;
    e.z = e.pz = start.z + oz;
    e.y = e.py = 0;
    e.vx = e.vz = e.vy = 0;
    e.act = null;
  });
  placeShade(w);
}

function npcFor(c: string): string {
  return ['smith', 'carver', 'well', 'board', 'skald', 'gate', 'trainer', 'stash'][c.charCodeAt(0) - 97]!;
}

export function spawnPlayer(w: World, p: PlayerSlot): Entity {
  const e = newEntity(w, 'player', p.character.cls, TEAM_PLAYERS, 0, 0);
  e.level = p.character.level;
  e.r = 0.42;
  e.h = 1.85;
  e.hpMax = p.stats.hpMax;
  e.hp = e.hpMax;
  e.poiseMax = 40;
  e.poise = 40;
  e.pl = {
    slot: p.slot,
    dodges: p.stats.dodgeCharges,
    dodgeAt: 0,
    empowered: -1,
    flasks: p.stats.flasks,
    buffer: null,
    chain: '',
    chainUntil: 0,
    buffDmg: 0,
    buffUntil: 0,
    dealt: 0,
    lock: 0,
    soft: 0,
    fireCd: 0,
    cds: [0, 0, 0, 0],
    ruin: 0,
    lastDodge: -1000,
    respawnAt: -1,
    downed: false,
    obsNear: 0,
    obsFar: 0,
    obsDodge: 0,
    dmgTaken: 0,
    maxHitFrac: 0,
  };
  p.entity = e.id;
  return e;
}

export function playerEntity(w: World, slot: number): Entity | null {
  const p = w.players[slot];
  if (!p) return null;
  return w.entities.find((e) => e.id === p.entity) ?? null;
}
