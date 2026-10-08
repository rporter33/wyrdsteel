import { api } from '../api';
import type { Item, GearSlot } from '../../core/loot/item';
import { itemName, itemStats, weaponDamage, itemArmor } from '../../core/loot/gear';
import { computeStats } from '../../core/progression/derive';
import type { CharacterState } from '../../core/progression/character';
import type { DerivedStats } from '../../core/progression/stats';
import { usable } from '../../core/loot/generate';

export const RARITY_LABEL: Record<string, string> = { worn: 'Worn', forged: 'Forged', runed: 'Runed', ascendant: 'Ascendant', relic: 'Relic' };

const STAT_LABEL: Record<string, [string, 'pct' | 'flat']> = {
  hp: ['Health', 'flat'],
  hpPct: ['Health', 'pct'],
  armor: ['Armour', 'flat'],
  speedPct: ['Move speed', 'pct'],
  dmgPct: ['Damage', 'pct'],
  meleePct: ['Melee damage', 'pct'],
  rangedPct: ['Ranged damage', 'pct'],
  airPct: ['Damage to airborne', 'pct'],
  lowHpPct: ['Damage when hurt', 'pct'],
  crit: ['Critical chance', 'pct'],
  critMult: ['Critical damage', 'pct'],
  atkSpeed: ['Attack speed', 'pct'],
  poisePct: ['Stagger power', 'pct'],
  statusPct: ['Status build-up', 'pct'],
  lifesteal: ['Life steal', 'pct'],
  cdr: ['Cooldowns', 'pct'],
  ruinGain: ['Ruin gain', 'pct'],
  weakPct: ['Weak-point damage', 'pct'],
  bountyPct: ['Bounty found', 'pct'],
  xpPct: ['Experience', 'pct'],
  dmgTakenPct: ['Damage taken', 'pct'],
  flaskHeal: ['Flask healing', 'pct'],
  onBurn: ['Burn build-up on hit', 'flat'],
  onChill: ['Chill build-up on hit', 'flat'],
  onShock: ['Shock build-up on hit', 'flat'],
  onRoot: ['Root build-up on hit', 'flat'],
};

export function statLine(stat: string, amt: number): string {
  const l = STAT_LABEL[stat];
  if (!l) return `${stat} ${amt}`;
  const sign = amt >= 0 ? '+' : '−';
  const v = Math.abs(amt);
  return l[1] === 'pct' ? `${sign}${Math.round(v * 1000) / 10}% ${l[0]}` : `${sign}${Math.round(v)} ${l[0]}`;
}

/** Stats with this item equipped in place of whatever is in its slot. */
function statsWith(c: CharacterState, it: Item): DerivedStats {
  const db = api().db;
  const slot = db.bases[it.base]!.slot;
  const clone: CharacterState = { ...c, equip: { ...c.equip, [slot]: it } };
  return computeStats(clone, db);
}

const avg = (r: [number, number]) => (r[0] + r[1]) / 2;

/** The headline differences equipping this item would make. */
export function compareLines(c: CharacterState, it: Item): { text: string; good: boolean }[] {
  const db = api().db;
  const now = computeStats(c, db);
  const next = statsWith(c, it);
  const out: { text: string; good: boolean }[] = [];
  const push = (label: string, a: number, b: number, pct = false, lowerBetter = false) => {
    const d = b - a;
    if (Math.abs(d) < 1e-6) return;
    const v = pct ? `${Math.round(Math.abs(d) * 1000) / 10}%` : `${Math.round(Math.abs(d) * 10) / 10}`;
    out.push({ text: `${d > 0 ? '+' : '−'}${v} ${label}`, good: lowerBetter ? d < 0 : d > 0 });
  };
  const slot = db.bases[it.base]!.slot;
  if (slot === 'melee') push('melee damage', avg(now.melee) * (1 + now.dmgPct + now.meleePct), avg(next.melee) * (1 + next.dmgPct + next.meleePct));
  if (slot === 'ranged') push('ranged damage', avg(now.ranged) * (1 + now.dmgPct + now.rangedPct), avg(next.ranged) * (1 + next.dmgPct + next.rangedPct));
  push('health', now.hpMax, next.hpMax);
  push('armour', now.armor, next.armor);
  push('critical chance', now.critChance, next.critChance, true);
  push('attack speed', now.atkSpeed, next.atkSpeed, true);
  push('damage taken', now.dmgTakenPct, next.dmgTakenPct, true, true);
  return out;
}

export function ItemCard(props: { it: Item; c: CharacterState; compare?: boolean }) {
  const db = api().db;
  const { it, c } = props;
  const base = db.bases[it.base]!;
  const dmg = weaponDamage(db, it);
  const armor = itemArmor(db, it);
  const kind = base.slot === 'melee' || base.slot === 'ranged' ? (db.weapons[base.kind]?.name ?? base.kind) : base.slot;
  const ok = usable(db, base, c.cls);
  const uni = it.unique ? db.uniques[it.unique] : null;
  return (
    <div class={`item-card r-${it.rarity}`}>
      <div class="ic-name">{itemName(db, it)}</div>
      <div class="ic-sub">
        {RARITY_LABEL[it.rarity]} {kind} · item level {it.ilvl}
      </div>
      {dmg && <div class="ic-main">{dmg[0]}–{dmg[1]} damage</div>}
      {armor > 0 && <div class="ic-main">{armor} armour</div>}
      {base.ruiner && <div class="ic-main">Ruiner: {db.ruiners[base.ruiner]?.name}</div>}
      <ul class="ic-lines">
        {it.affixes.map((a) => {
          const def = db.affixes.find((x) => x.id === a.id);
          return <li key={a.id}>{def ? statLine(def.stat, a.v) : a.id}</li>;
        })}
      </ul>
      {uni && <p class="ic-unique">{uni.desc}</p>}
      {it.sockets.length > 0 && (
        <div class="ic-sockets">
          {it.sockets.map((r, i) => (
            <span key={i} class={'sock' + (r ? ' full' : '')} title={r ? db.runes[r]?.name : 'Empty socket'}>
              {r ? db.runes[r]?.name : '◇'}
            </span>
          ))}
        </div>
      )}
      {!ok && <div class="ic-bad">Your class can't use this.</div>}
      {props.compare && ok && (
        <ul class="ic-compare">
          {compareLines(c, it).map((l, i) => (
            <li key={i} class={l.good ? 'good' : 'bad'}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const SLOT_LABEL: Record<GearSlot, string> = { melee: 'Melee', ranged: 'Ranged', helm: 'Helm', chest: 'Chest', hands: 'Hands', legs: 'Legs', charm: 'Charm' };

export { itemStats };
