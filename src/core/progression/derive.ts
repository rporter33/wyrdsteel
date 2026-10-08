import type { ContentDb } from '../data/types';
import type { CharacterState } from './character';
import { baseStats, applyStat, type DerivedStats } from './stats';
import { applySkills } from './skills';
import { applyGear } from '../loot/gear';

/** Everything that feeds a player's numbers, in order: class and level, gear, skills, clamps. */
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
    // Unarmed weapons scale gently with level until real gear arrives.
    if (mw) s.melee = [mw.dmg[0] * (1 + 0.08 * (c.level - 1)), mw.dmg[1] * (1 + 0.08 * (c.level - 1))];
    if (rw) s.ranged = [rw.dmg[0] * (1 + 0.08 * (c.level - 1)), rw.dmg[1] * (1 + 0.08 * (c.level - 1))];
  }
  applyGear(c, db, s);
  applySkills(c, db, s);
  void applyStat;
  s.critChance = Math.min(0.75, s.critChance);
  s.cdr = Math.min(0.5, s.cdr);
  s.lifesteal = Math.min(0.2, s.lifesteal);
  s.atkSpeed = Math.max(0.5, Math.min(1.6, s.atkSpeed));
  s.dmgTakenPct = Math.max(-0.5, s.dmgTakenPct);
  s.hpMax = Math.max(1, Math.round(s.hpMax));
  return s;
}
