import type { ContentDb } from '../data/types';
import { RARITIES, GEAR_SLOTS, type Item } from '../loot/item';
import { newCharacter, type CharacterState } from '../progression/character';
import { validateAllocation, classPoints, aspectPoints } from '../progression/skills';
import { LEVEL_CAP, XP_TABLE } from '../progression/rewards';
import { DEFAULT_SETTINGS, SAVE_FORMAT, SAVE_VERSION, SLOTS, type CharacterSave, type SaveFile, type Settings } from './schema';

export interface Skipped {
  path: string;
  reason: string;
}

export interface ParseResult {
  save: SaveFile | null;
  skipped: Skipped[];
  error: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

/** Version-to-version migrations. Each takes the previous shape and returns the next. */
const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // 0 -> 1: early builds stored a single character at the top level.
  0: (s) => ({ ...s, v: 1, characters: s.character ? [{ ...s.character, slot: 0 }] : [], profile: s.profile ?? { stash: [], settings: {}, unlocks: {} } }),
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * Restore what can be restored. A broken item drops that item, a broken affix drops that affix,
 * a broken character drops that character; everything dropped is listed so the player knows.
 */
export function parseSave(text: string, db: ContentDb, renames: Record<string, string> = {}): ParseResult {
  const skipped: Skipped[] = [];
  let raw: Raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { save: null, skipped, error: 'Not a save file (not valid JSON).' };
  }
  if (!isObj(raw) || raw.format !== SAVE_FORMAT) return { save: null, skipped, error: 'Not a Wyrdsteel save file.' };
  let v = num(raw.v, 0);
  if (v > SAVE_VERSION) return { save: null, skipped, error: `This save is from a newer version (${v}).` };
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { save: null, skipped, error: `No migration from save version ${v}.` };
    raw = m(raw);
    v = raw.v;
  }
  const ren = (id: string) => renames[id] ?? id;
  const profile = isObj(raw.profile) ? raw.profile : {};
  const save: SaveFile = {
    format: SAVE_FORMAT,
    v: SAVE_VERSION,
    contentVersion: num(raw.contentVersion, 1),
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    profile: {
      stash: items(profile.stash, db, ren, 'stash', skipped),
      settings: settings(profile.settings, skipped),
      unlocks: isObj(profile.unlocks) ? (profile.unlocks as Record<string, number>) : {},
    },
    characters: [],
  };
  const chars = Array.isArray(raw.characters) ? raw.characters : [];
  chars.forEach((cs: Raw, i: number) => {
    const c = character(cs, db, ren, `characters[${i}]`, skipped);
    if (c && !save.characters.some((x) => x.slot === c.slot)) save.characters.push(c);
  });
  return { save, skipped, error: null };
}

function settings(s: Raw, skipped: Skipped[]): Settings {
  const out = { ...DEFAULT_SETTINGS, keys: {} as Record<string, string[]> };
  if (!isObj(s)) return out;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = s[k];
    if (v === undefined) continue;
    if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v;
    else skipped.push({ path: `settings.${k}`, reason: 'wrong type; default used' });
  }
  out.assist = Math.max(0, Math.min(1, out.assist));
  if (![0, 1, 2].includes(out.difficulty)) out.difficulty = 1;
  return out;
}

export function item(r: Raw, db: ContentDb, ren: (id: string) => string, path: string, skipped: Skipped[]): Item | null {
  if (!isObj(r) || typeof r.base !== 'string' || typeof r.uid !== 'string') {
    skipped.push({ path, reason: 'not an item' });
    return null;
  }
  const base = ren(r.base);
  if (!db.bases[base]) {
    skipped.push({ path, reason: `unknown item base "${r.base}"` });
    return null;
  }
  const rarity = RARITIES.includes(r.rarity as never) ? (r.rarity as Item['rarity']) : null;
  if (!rarity) {
    skipped.push({ path, reason: `unknown rarity "${String(r.rarity)}"` });
    return null;
  }
  const affixes: Item['affixes'] = [];
  (Array.isArray(r.affixes) ? r.affixes : []).forEach((a: Raw, i: number) => {
    const id = isObj(a) && typeof a.id === 'string' ? ren(a.id) : '';
    if (id && db.affixes.some((x) => x.id === id) && typeof a.v === 'number' && Number.isFinite(a.v)) affixes.push({ id, v: a.v });
    else skipped.push({ path: `${path}.affixes[${i}]`, reason: `unknown affix "${isObj(a) ? String(a.id) : '?'}" removed` });
  });
  const sockets: Item['sockets'] = (Array.isArray(r.sockets) ? r.sockets : []).slice(0, 3).map((s: Raw, i: number) => {
    if (s === null) return null;
    const id = typeof s === 'string' ? ren(s) : '';
    if (db.runes[id]) return id;
    skipped.push({ path: `${path}.sockets[${i}]`, reason: `unknown rune "${String(s)}" removed` });
    return null;
  });
  let unique = typeof r.unique === 'string' ? r.unique : null;
  if (unique && !db.uniques[unique]) {
    skipped.push({ path: `${path}.unique`, reason: `unknown unique "${unique}" removed` });
    unique = null;
  }
  return { uid: r.uid, base, rarity, ilvl: Math.max(1, Math.min(40, Math.round(num(r.ilvl, 1)))), affixes, sockets, seed: num(r.seed, 0) >>> 0, unique, v: 1 };
}

function items(list: Raw, db: ContentDb, ren: (id: string) => string, path: string, skipped: Skipped[]): Item[] {
  const out: Item[] = [];
  (Array.isArray(list) ? list : []).forEach((r: Raw, i: number) => {
    const it = item(r, db, ren, `${path}[${i}]`, skipped);
    if (it) out.push(it);
  });
  return out;
}

function character(cs: Raw, db: ContentDb, ren: (id: string) => string, path: string, skipped: Skipped[]): CharacterSave | null {
  if (!isObj(cs) || !isObj(cs.character)) {
    skipped.push({ path, reason: 'not a character' });
    return null;
  }
  const r = cs.character as Raw;
  if (typeof r.cls !== 'string' || !db.classes[r.cls]) {
    skipped.push({ path, reason: `unknown class "${String(r.cls)}"` });
    return null;
  }
  const slot = Math.round(num(cs.slot, -1));
  if (slot < 0 || slot >= SLOTS) {
    skipped.push({ path, reason: 'bad slot' });
    return null;
  }
  const c: CharacterState = newCharacter(typeof r.name === 'string' ? r.name.slice(0, 18) : 'Sworn', r.cls);
  c.level = Math.max(1, Math.min(LEVEL_CAP, Math.round(num(r.level, 1))));
  c.xp = Math.max(XP_TABLE[c.level] ?? 0, Math.round(num(r.xp, 0)));
  c.bounty = Math.max(0, Math.round(num(r.bounty, 0)));
  c.alignment = r.alignment === 'human' || r.alignment === 'cyber' ? r.alignment : null;
  c.deaths = Math.max(0, Math.round(num(r.deaths, 0)));
  c.sigils = Math.max(0, Math.round(num(r.sigils, 0)));
  for (const s of GEAR_SLOTS) {
    const e = isObj(r.equip) ? r.equip[s] : null;
    if (e === null || e === undefined) continue;
    const it = item(e, db, ren, `${path}.equip.${s}`, skipped);
    if (it && db.bases[it.base]!.slot === s) c.equip[s] = it;
    else if (it) skipped.push({ path: `${path}.equip.${s}`, reason: 'item in the wrong slot' });
  }
  c.inv = items(r.inv, db, ren, `${path}.inv`, skipped).slice(0, 40);
  c.recentSalvage = items(r.recentSalvage, db, ren, `${path}.recentSalvage`, skipped).slice(-10);
  for (const [k, n] of Object.entries(isObj(r.runes) ? r.runes : {})) {
    const id = ren(k);
    if (db.runes[id] && typeof n === 'number' && n > 0) c.runes[id] = (c.runes[id] ?? 0) + Math.round(n);
    else if (typeof n === 'number' && n > 0) skipped.push({ path: `${path}.runes.${k}`, reason: 'unknown rune' });
  }
  for (const [k, n] of Object.entries(isObj(r.mats) ? r.mats : {})) if (typeof n === 'number' && n > 0 && k.startsWith('mat.')) c.mats[k] = Math.round(n);
  c.blueprints = (Array.isArray(r.blueprints) ? r.blueprints : []).filter((b: unknown) => typeof b === 'string' && db.blueprints[b as string]);
  c.charms = (Array.isArray(r.charms) ? r.charms : [])
    .filter((q: Raw) => isObj(q) && db.charms[q.id as string])
    .map((q: Raw) => ({ id: q.id, progress: (Array.isArray(q.progress) ? q.progress : []).map((x: unknown) => num(x, 0)), done: !!q.done }));
  c.story = isObj(r.story) ? (r.story as Record<string, number>) : {};
  c.kills = isObj(r.kills) ? (r.kills as Record<string, number>) : {};
  c.abilities = (Array.isArray(r.abilities) ? r.abilities : []).filter((a: unknown) => a === '' || (typeof a === 'string' && db.abilities[a])).slice(0, 4);
  if (isObj(r.autoSalvage)) c.autoSalvage = { maxRarity: num(r.autoSalvage.maxRarity, -1), onlyIfWorse: r.autoSalvage.onlyIfWorse !== false, keepSockets: num(r.autoSalvage.keepSockets, 0) };
  c.bossPity = RARITIES.includes(r.bossPity) ? r.bossPity : null;
  // Skills: keep a valid allocation; if any rule fails, refund that tree rather than guess.
  const sk = isObj(r.skills) ? r.skills : {};
  const tree = db.classes[c.cls]!.tree;
  const cls = isObj(sk.cls) ? (sk.cls as Record<string, number>) : {};
  if (validateAllocation(tree, cls, classPoints(c), c.cls).length) skipped.push({ path: `${path}.skills.cls`, reason: 'invalid allocation refunded' });
  else c.skills.cls = cls;
  for (const a of ['human', 'cyber'] as const) {
    const al = isObj(sk.aspect) && isObj(sk.aspect[a]) ? (sk.aspect[a] as Record<string, number>) : {};
    const budget = c.alignment ? aspectPoints(c) : 0;
    if (validateAllocation(db.alignTrees[a], al, budget, c.cls).length) {
      if (Object.keys(al).length) skipped.push({ path: `${path}.skills.aspect.${a}`, reason: 'invalid allocation refunded' });
    } else c.skills.aspect[a] = al;
  }
  c.skills.respecs = Math.max(0, Math.round(num(sk.respecs, 0)));
  c.skills.swaps = Math.max(0, Math.round(num(sk.swaps, 0)));
  const z = isObj(cs.zone) ? cs.zone : {};
  const zoneId = typeof z.id === 'string' && db.zones[z.id] ? z.id : 'training';
  const zone = db.zones[zoneId]!;
  const node = typeof z.node === 'string' && zone.nodes.some((n) => n.id === z.node) ? z.node : zone.start;
  return {
    slot,
    character: c,
    zone: {
      id: zoneId,
      node,
      cleared: (Array.isArray(z.cleared) ? z.cleared : []).filter((n: unknown) => typeof n === 'string' && zone.nodes.some((x) => x.id === n)),
      shade: isObj(z.shade) && typeof z.shade.node === 'string' ? { node: z.shade.node, x: num(z.shade.x, 0), z: num(z.shade.z, 0), amount: Math.max(0, num(z.shade.amount, 0)) } : null,
      mods: Array.isArray(z.mods) ? z.mods.filter((m: unknown) => typeof m === 'string') : [],
      trial: Math.max(0, num(z.trial, 0)),
    },
    difficulty: cs.difficulty === 0 || cs.difficulty === 2 ? cs.difficulty : 1,
    seed: num(cs.seed, 1) >>> 0,
    playMs: Math.max(0, num(cs.playMs, 0)),
    savedAt: typeof cs.savedAt === 'string' ? cs.savedAt : '',
  };
}
