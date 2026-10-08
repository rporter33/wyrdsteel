/** Armor constant grows with the attacker's level so armor neither trivialises nor vanishes. */
export function armorFactor(armor: number, attackerLevel: number): number {
  const k = 40 + 12 * attackerLevel;
  return k / (k + Math.max(0, armor));
}

export interface DamageInput {
  base: number;
  mult: number;
  pct: number;
  crit: boolean;
  critMult: number;
  weak: number;
  airborne: boolean;
  armor: number;
  attackerLevel: number;
  /** Fraction of the target's max HP one hit may deal (players only); 0 = uncapped. */
  cap: number;
  targetHpMax: number;
  taken: number;
}

/** One hit's damage. Integer out; never zero; never more than the per-hit cap on a player. */
export function computeDamage(d: DamageInput): number {
  let raw = d.base * d.mult * (1 + d.pct);
  if (d.crit) raw *= d.critMult;
  raw *= d.weak;
  if (d.airborne) raw *= 1.1;
  raw *= armorFactor(d.armor, d.attackerLevel);
  raw *= 1 + d.taken;
  let dmg = Math.max(1, Math.round(raw));
  if (d.cap > 0) dmg = Math.min(dmg, Math.max(1, Math.floor(d.targetHpMax * d.cap)));
  return dmg;
}

/** Juggle lift decays per air hit so a juggle always ends: lift * 0.8^hits. */
export function juggleLift(lift: number, hits: number): number {
  let m = 1;
  for (let i = 0; i < hits; i++) m *= 0.8;
  return lift * m;
}
