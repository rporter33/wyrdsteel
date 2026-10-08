// Turns authored packs (milliseconds, degrees, optional fields) into the ContentDb the sim reads
// (ticks, cosines, every field present). Runs once at boot and once per test file.
import { msToTicks, TICK_HZ } from '../sim/constants';
import { cos, sin, degToRad } from '../math/trig';
import { hashString } from '../rng/xoshiro';
import type {
  ActionDef,
  AbilityDef,
  ClassDef,
  ContentDb,
  EnemyDef,
  HitDef,
  ProjectileDef,
  TreeDef,
  WeaponKindDef,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export interface RawPacks {
  version: number;
  actions: Raw[];
  weapons: Raw[];
  projectiles: Raw[];
  abilities: Raw[];
  classes: Raw[];
  trees: Raw[];
  enemies: Raw[];
  elites: Raw[];
  affixes: Raw[];
  bases: Raw[];
  runes: Raw[];
  charms: Raw[];
  ruiners: Raw[];
  blueprints: Raw[];
  drops: Raw[];
  rooms: Raw[];
  zones: Raw[];
  story: Raw[];
  wyrd: Raw[];
  uniques: Raw[];
  codex: Raw[];
}

const t = (ms: number | undefined, d = 0) => (ms === undefined ? d : msToTicks(ms));
const pair = (v: [number, number] | undefined): [number, number] | null => (v ? [t(v[0]), t(v[1])] : null);

function hit(h: Raw): HitDef {
  const arc = h.arc ?? 60;
  return {
    from: t(h.ms[0]),
    to: Math.max(t(h.ms[0]), t(h.ms[1])),
    shape: h.shape ?? 'sector',
    range: h.range ?? 2,
    cosArc: cos(degToRad(arc)),
    width: h.width ?? 1,
    offset: h.offset ?? 0,
    yMin: h.y?.[0] ?? -0.5,
    yMax: h.y?.[1] ?? 2.2,
    dmg: h.dmg ?? 1,
    poise: h.poise ?? 10,
    launch: h.launch ?? 0,
    knock: h.knock ?? 0,
    down: !!h.down,
    stop: t(h.stopMs, 3),
    status: h.status ?? null,
    guardBreak: !!h.guardBreak,
    tag: h.tag ?? 'light',
    cap: h.cap ?? 0.35,
    at: h.at ?? 'self',
  };
}

export function action(a: Raw): ActionDef {
  const spread = degToRad(a.shoot?.spread ?? 0);
  return {
    id: a.id,
    pose: a.pose ?? 'slashR',
    len: t(a.ms),
    move: a.move ?? 0,
    turn: degToRad(a.turn ?? 360) / TICK_HZ,
    lunge: a.lunge ? { from: t(a.lunge[0]), to: t(a.lunge[1]), dist: a.lunge[2] } : null,
    hits: (a.hits ?? []).map(hit),
    cancel: t(a.cancelMs, t(a.ms)),
    armor: pair(a.armorMs),
    iframes: pair(a.iframesMs),
    jump: a.jump ? { at: t(a.jump[0]), vy: a.jump[1], ifHeld: !!a.jump[2] } : null,
    air: !!a.air,
    hover: a.hover ?? 1,
    shoot: a.shoot
      ? {
          at: (a.shoot.ms as number[]).map((m) => t(m)),
          proj: a.shoot.proj,
          count: a.shoot.count ?? 1,
          spreadCos: cos(spread),
          spreadSin: sin(spread),
          dmg: a.shoot.dmg ?? 1,
        }
      : null,
    slam: !!a.slam,
    tele: a.tele ?? null,
    dash: a.dash ? { from: t(a.dash[0]), to: t(a.dash[1]), dist: a.dash[2] } : null,
    buff: a.buff ? { stat: a.buff.stat, amt: a.buff.amt, dur: t(a.buff.ms) } : null,
    spawn: a.spawn ? { at: t(a.spawn.ms), def: a.spawn.def, count: a.spawn.count ?? 1 } : null,
    heal: a.heal ?? 0,
  };
}

function weapon(w: Raw): WeaponKindDef {
  const spread = degToRad(w.fire?.spread ?? 0);
  return {
    id: w.id,
    name: w.name,
    hand: w.hand,
    classes: w.classes ?? [],
    combo: w.combo ?? [],
    fire: w.fire
      ? {
          proj: w.fire.proj,
          interval: t(w.fire.intervalMs),
          count: w.fire.count ?? 1,
          spreadCos: cos(spread),
          spreadSin: sin(spread),
          auto: w.fire.auto ?? true,
          moveMult: w.fire.moveMult ?? 0.8,
          range: w.fire.range ?? 20,
        }
      : null,
    dmg: w.dmg,
    speed: w.speed ?? 1,
  };
}

function projectile(p: Raw): ProjectileDef {
  return {
    id: p.id,
    speed: p.speed,
    radius: p.radius ?? 0.2,
    life: t(p.lifeMs, 60),
    pierce: p.pierce ?? 0,
    gravity: p.gravity ?? 0,
    homing: degToRad(p.homing ?? 0) / TICK_HZ,
    aoe: p.aoe ?? 0,
    status: p.status ?? null,
    poise: p.poise ?? 4,
    launch: p.launch ?? 0,
    stop: t(p.stopMs, 1),
    color: p.color ?? '#ffffff',
    fragile: !!p.fragile,
    trigger: !!p.trigger,
  };
}

function ability(a: Raw): AbilityDef {
  return { id: a.id, name: a.name, cls: a.cls, cd: t(a.cdMs), action: a.action, desc: a.desc, unlock: a.unlock ?? null };
}

function tree(tr: Raw): TreeDef {
  return {
    id: tr.id,
    paths: tr.paths,
    nodes: tr.nodes.map((n: Raw) => ({
      id: n.id,
      name: n.name,
      path: n.path,
      row: n.row,
      maxRank: n.maxRank ?? 1,
      requires: n.requires ?? [],
      effects: n.effects ?? [],
      ability: n.ability ?? null,
      desc: n.desc ?? '',
      cls: n.cls ?? null,
    })),
  };
}

function enemy(e: Raw): EnemyDef {
  return {
    id: e.id,
    name: e.name,
    brain: e.brain,
    hp: e.hp,
    hpPerLevel: e.hpPerLevel ?? e.hp * 0.12,
    dmg: e.dmg,
    dmgPerLevel: e.dmgPerLevel ?? e.dmg * 0.1,
    armor: e.armor ?? 0,
    speed: e.speed,
    radius: e.radius ?? 0.45,
    height: e.height ?? 1.7,
    poise: e.poise ?? 20,
    weight: e.weight ?? 'light',
    xp: e.xp,
    bounty: e.bounty ?? 1,
    attacks: (e.attacks ?? []).map((a: Raw) => ({
      action: a.action,
      min: a.min ?? 0,
      max: a.max ?? 2,
      cd: t(a.cdMs, 1500),
      kind: a.kind ?? 'melee',
      weight: a.weight ?? 1,
      needsPart: a.needsPart ?? null,
    })),
    range: e.range ?? 1.6,
    keep: e.keep ?? [0, e.range ?? 1.6],
    aggro: e.aggro ?? 11,
    guard: e.guard ?? 'none',
    parts: e.parts ?? [],
    resist: e.resist ?? {},
    drop: e.drop ?? 'common',
    color: e.color ?? '#888888',
    model: e.model ?? e.id,
  };
}

function byId<T extends { id: string }>(xs: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of xs) out[x.id] = x;
  return out;
}

export function loadContent(raw: RawPacks): ContentDb {
  const trees = raw.trees.map(tree);
  const treeById = byId(trees);
  const classes: ClassDef[] = raw.classes.map((c: Raw) => ({ ...c, tree: treeById[c.tree]! }));
  return {
    version: raw.version,
    hash: hashString(JSON.stringify(raw)).toString(16),
    actions: byId(raw.actions.map(action)),
    weapons: byId(raw.weapons.map(weapon)),
    projectiles: byId(raw.projectiles.map(projectile)),
    abilities: byId(raw.abilities.map(ability)),
    classes: byId(classes),
    alignTrees: { human: treeById['align.human']!, cyber: treeById['align.cyber']! },
    enemies: byId(raw.enemies.map(enemy)),
    elites: byId(raw.elites),
    affixes: raw.affixes,
    bases: byId(raw.bases),
    runes: byId(raw.runes),
    charms: byId(raw.charms),
    ruiners: byId(raw.ruiners),
    blueprints: byId(raw.blueprints),
    drops: byId(raw.drops),
    rooms: byId(raw.rooms),
    zones: byId(raw.zones),
    story: byId(raw.story),
    wyrd: byId(raw.wyrd),
    uniques: byId(raw.uniques),
    codex: raw.codex,
  };
}
