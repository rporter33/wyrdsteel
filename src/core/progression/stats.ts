import type { ContentDb } from '../data/types';
import type { CharacterState } from './character';

/** Everything combat reads about a player, recomputed when gear, skills or level change. */
export interface DerivedStats {
  hpMax: number;
  armor: number;
  speed: number;
  meleeKind: string;
  rangedKind: string;
  melee: [number, number];
  ranged: [number, number];
  /** Additive damage bonuses as fractions (0.2 = +20%). */
  dmgPct: number;
  meleePct: number;
  rangedPct: number;
  airPct: number;
  lowHpPct: number;
  critChance: number;
  critMult: number;
  atkSpeed: number;
  poiseMult: number;
  statusPct: number;
  lifesteal: number;
  cdr: number;
  ruinGain: number;
  weakPct: number;
  dodgeCharges: number;
  flasks: number;
  flaskHeal: number;
  bountyPct: number;
  xpPct: number;
  dmgTakenPct: number;
  onHit: { k: 'root' | 'chill' | 'burn' | 'shock'; amt: number }[];
  /** Flat stat ids from skills/affixes the sim checks by name (capstones, uniques). */
  flags: string[];
}

export function baseStats(): DerivedStats {
  return {
    hpMax: 100,
    armor: 0,
    speed: 6.5,
    meleeKind: 'sword',
    rangedKind: 'pistols',
    melee: [8, 12],
    ranged: [5, 7],
    dmgPct: 0,
    meleePct: 0,
    rangedPct: 0,
    airPct: 0,
    lowHpPct: 0,
    critChance: 0.05,
    critMult: 1.5,
    atkSpeed: 1,
    poiseMult: 1,
    statusPct: 0,
    lifesteal: 0,
    cdr: 0,
    ruinGain: 1,
    weakPct: 0,
    dodgeCharges: 2,
    flasks: 3,
    flaskHeal: 0.4,
    bountyPct: 0,
    xpPct: 0,
    dmgTakenPct: 0,
    onHit: [],
    flags: [],
  };
}

/** Adds one named stat modifier. Unknown names become flags so content can grow without code. */
export function applyStat(s: DerivedStats, stat: string, amt: number): void {
  switch (stat) {
    case 'hp':
      s.hpMax += amt;
      break;
    case 'hpPct':
      s.hpMax = Math.round(s.hpMax * (1 + amt));
      break;
    case 'armor':
      s.armor += amt;
      break;
    case 'speedPct':
      s.speed *= 1 + amt;
      break;
    case 'dmgPct':
      s.dmgPct += amt;
      break;
    case 'meleePct':
      s.meleePct += amt;
      break;
    case 'rangedPct':
      s.rangedPct += amt;
      break;
    case 'airPct':
      s.airPct += amt;
      break;
    case 'lowHpPct':
      s.lowHpPct += amt;
      break;
    case 'crit':
      s.critChance += amt;
      break;
    case 'critMult':
      s.critMult += amt;
      break;
    case 'atkSpeed':
      s.atkSpeed += amt;
      break;
    case 'poisePct':
      s.poiseMult += amt;
      break;
    case 'statusPct':
      s.statusPct += amt;
      break;
    case 'lifesteal':
      s.lifesteal += amt;
      break;
    case 'cdr':
      s.cdr += amt;
      break;
    case 'ruinGain':
      s.ruinGain += amt;
      break;
    case 'weakPct':
      s.weakPct += amt;
      break;
    case 'dodge':
      s.dodgeCharges += amt;
      break;
    case 'flasks':
      s.flasks += amt;
      break;
    case 'flaskHeal':
      s.flaskHeal += amt;
      break;
    case 'bountyPct':
      s.bountyPct += amt;
      break;
    case 'xpPct':
      s.xpPct += amt;
      break;
    case 'dmgTakenPct':
      s.dmgTakenPct += amt;
      break;
    case 'meleeFlat':
      s.melee = [s.melee[0] + amt, s.melee[1] + amt];
      break;
    case 'rangedFlat':
      s.ranged = [s.ranged[0] + amt, s.ranged[1] + amt];
      break;
    case 'onRoot':
    case 'onChill':
    case 'onBurn':
    case 'onShock': {
      const k = stat.slice(2).toLowerCase() as 'root' | 'chill' | 'burn' | 'shock';
      const cur = s.onHit.find((o) => o.k === k);
      if (cur) cur.amt += amt;
      else s.onHit.push({ k, amt });
      break;
    }
    default:
      if (amt !== 0 && !s.flags.includes(stat)) s.flags.push(stat);
  }
}

/** Gear and skill modules add their contributions; listed explicitly in compute order. */
const contributors: ((c: CharacterState, db: ContentDb, s: DerivedStats) => void)[] = [];
export function setContributors(fns: ((c: CharacterState, db: ContentDb, s: DerivedStats) => void)[]): void {
  contributors.length = 0;
  contributors.push(...fns);
}

export function computeStats(c: CharacterState, db: ContentDb): DerivedStats {
  const s = baseStats();
  const cls = db.classes[c.cls];
  if (cls) {
    s.hpMax = cls.hp + cls.hpPerLevel * (c.level - 1);
    s.speed = cls.speed;
    s.armor = cls.armor + (c.level - 1) * 2;
    s.meleeKind = cls.startMelee;
    s.rangedKind = cls.startRanged;
    const mw = db.weapons[cls.startMelee];
    const rw = db.weapons[cls.startRanged];
    if (mw) s.melee = [mw.dmg[0], mw.dmg[1]];
    if (rw) s.ranged = [rw.dmg[0], rw.dmg[1]];
  }
  for (const extra of contributors) extra(c, db, s);
  s.critChance = Math.min(0.75, s.critChance);
  s.cdr = Math.min(0.5, s.cdr);
  s.lifesteal = Math.min(0.2, s.lifesteal);
  s.atkSpeed = Math.max(0.5, Math.min(1.6, s.atkSpeed));
  s.hpMax = Math.max(1, Math.round(s.hpMax));
  return s;
}
