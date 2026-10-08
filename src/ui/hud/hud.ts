import type { ContentDb } from '../../core/data/types';
import type { World } from '../../core/sim/types';
import { boundAbilities } from '../../core/combat/attack';
import { XP_TABLE, LEVEL_CAP } from '../../core/progression/rewards';
import { inHeat } from '../../core/level/hazards';

const NPC_LABEL: Record<string, string> = {
  smith: 'Brokkr — smithy',
  carver: 'Rune-carver',
  well: "Idunn's Well — skills",
  board: 'Quest board',
  skald: 'Bragi — codex',
  gate: 'Wyrd gate — travel',
  trainer: 'Training yard',
  stash: 'Stash',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

/**
 * The HUD changes every frame, so it is plain DOM written field by field, and only when a value
 * actually changed. No framework diffing in the per-frame path.
 */
export class Hud {
  private root: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private dodges: HTMLElement;
  private flasks: HTMLElement;
  private perf: HTMLElement;
  private abil: HTMLElement;
  private abilSlots: { root: HTMLElement; cd: HTMLElement; name: HTMLElement }[] = [];
  private ruin: HTMLElement;
  private ruinFill: HTMLElement;
  private target: HTMLElement;
  private targetName: HTMLElement;
  private targetFill: HTMLElement;
  private targetParts: HTMLElement;
  private dps: HTMLElement;
  private dpsWindow: { t: number; d: number }[] = [];
  private lastDealt = 0;
  private hint: HTMLElement;
  private lvl: HTMLElement;
  private xpFill: HTMLElement;
  private bounty: HTMLElement;
  private zoneEl: HTMLElement;
  private prompt: HTMLElement;
  private heat: HTMLElement;
  private last: Record<string, string | number> = {};
  showPerf = false;

  constructor(host: HTMLElement) {
    this.root = el('div', 'hud-root', host);
    const vitals = el('div', 'hud-vitals', this.root);
    const hp = el('div', 'bar hp', vitals);
    this.hpFill = el('div', 'fill', hp);
    this.hpText = el('div', 'bar-text', hp);
    const row = el('div', 'hud-row', vitals);
    this.dodges = el('div', 'pips', row);
    this.flasks = el('div', 'flasks', row);
    this.ruin = el('div', 'bar ruin', vitals);
    this.ruinFill = el('div', 'fill', this.ruin);
    el('div', 'bar-text', this.ruin).textContent = 'RUIN';
    this.abil = el('div', 'hud-abilities', this.root);
    for (let i = 0; i < 4; i++) {
      const root = el('div', 'ab', this.abil);
      el('div', 'key', root).textContent = String(i + 1);
      const name = el('div', 'name', root);
      const cd = el('div', 'cd', root);
      this.abilSlots.push({ root, cd, name });
    }
    this.target = el('div', 'hud-target', this.root);
    this.targetName = el('div', 'tname', this.target);
    const tb = el('div', 'bar thp', this.target);
    this.targetFill = el('div', 'fill', tb);
    this.targetParts = el('div', 'tparts', this.target);
    this.dps = el('div', 'hud-dps', this.root);
    this.hint = el('div', 'hud-hint', this.root);
    const prog = el('div', 'hud-prog', this.root);
    this.lvl = el('div', 'lvl', prog);
    const xp = el('div', 'xp', prog);
    this.xpFill = el('div', '', xp);
    this.bounty = el('div', 'bounty', prog);
    this.zoneEl = el('div', 'zone', prog);
    this.prompt = el('div', 'hud-prompt', this.root);
    this.heat = el('div', 'hud-heat', this.root);
    this.perf = el('div', 'perf', this.root);
    this.root.style.display = 'none';
  }

  private set(key: string, v: string | number, apply: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    apply();
  }

  show(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  setHint(text: string): void {
    this.set('hint', text, () => {
      this.hint.textContent = text;
      this.hint.style.display = text ? '' : 'none';
    });
  }

  update(w: World, db: ContentDb, slot: number, perf: { fps: number; simMs: number; calls: number; tris: number }): void {
    const p = w.players[slot];
    const e = p ? w.entities.find((x) => x.id === p.entity) : null;
    if (!p || !e || !e.pl) return;
    const hp = Math.max(0, Math.ceil(e.hp));
    this.set('hp', `${hp}/${e.hpMax}`, () => {
      this.hpFill.style.width = `${(100 * hp) / e.hpMax}%`;
      this.hpText.textContent = `${hp} / ${e.hpMax}`;
    });
    this.set('dodge', `${e.pl.dodges}/${p.stats.dodgeCharges}`, () => {
      this.dodges.innerHTML = '';
      for (let i = 0; i < p.stats.dodgeCharges; i++) el('span', 'pip' + (i < e.pl!.dodges ? ' on' : ''), this.dodges);
    });
    this.set('flask', e.pl.flasks, () => (this.flasks.textContent = `Flask ×${e.pl!.flasks}`));
    const ruin = Math.floor(e.pl.ruin);
    this.set('ruin', ruin, () => {
      this.ruinFill.style.width = `${ruin}%`;
      this.ruin.classList.toggle('full', ruin >= 100);
    });
    const abilities = boundAbilities(p, db);
    for (let i = 0; i < 4; i++) {
      const id = abilities[i];
      const def = id ? db.abilities[id] : null;
      const slotEl = this.abilSlots[i]!;
      this.set(`ab${i}`, def?.name ?? '', () => {
        slotEl.name.textContent = def?.name ?? '';
        slotEl.root.classList.toggle('empty', !def);
      });
      const cd = e.pl.cds[i] ?? 0;
      const total = def ? Math.round(def.cd * (1 - p.stats.cdr)) : 1;
      const frac = def && cd > 0 ? cd / total : 0;
      this.set(`cd${i}`, Math.ceil(frac * 20), () => {
        slotEl.cd.style.height = `${frac * 100}%`;
        slotEl.root.classList.toggle('ready', frac === 0 && !!def);
      });
    }
    const c = p.character;
    this.set('lvl', `${c.name}:${c.level}`, () => (this.lvl.textContent = `${c.name} · Level ${c.level}`));
    const lo = XP_TABLE[c.level] ?? 0;
    const hi = XP_TABLE[c.level + 1] ?? lo + 1;
    const xpFrac = c.level >= LEVEL_CAP ? 1 : (c.xp - lo) / Math.max(1, hi - lo);
    this.set('xp', Math.round(xpFrac * 200), () => (this.xpFill.style.width = `${xpFrac * 100}%`));
    this.set('bounty', c.bounty, () => (this.bounty.textContent = `◆ ${c.bounty} bounty`));
    const zone = db.zones[w.zone.id];
    const room = db.rooms[w.room.id];
    const active = w.room.encounters.find((x) => x.state === 'active');
    const zoneText = `${zone?.name ?? ''}${room ? ' — ' + room.name : ''}${active ? ` · wave ${active.wave + 1}/${active.waves.length}` : w.room.cleared ? ' · cleared' : ''}`;
    this.set('zone', zoneText, () => (this.zoneEl.textContent = zoneText));
    // Blizzard: are you in heat?
    const surging = w.room.surgeEnd > w.tick;
    const warn = w.room.surgeAt > w.tick && w.room.surgeAt - w.tick < 180;
    const heatState = surging ? (inHeat(w, e) ? 'warm' : 'cold') : warn ? 'cold' : '';
    this.set('heat', heatState + (warn ? 'w' : ''), () => {
      this.heat.className = 'hud-heat ' + heatState;
      this.heat.textContent = warn ? 'A surge is coming: find heat' : heatState === 'warm' ? 'Warm' : heatState === 'cold' ? 'Blizzard: freezing — find a brazier' : '';
    });
    // Context prompt: finisher on a kneeling heavy, or a nearby NPC.
    let prompt = '';
    for (const t of w.entities) {
      if (t.kind === 'enemy' && !t.dead && t.stunKind === 2 && t.parts && (t.x - e.x) * (t.x - e.x) + (t.z - e.z) * (t.z - e.z) < (t.r + 1.6) * (t.r + 1.6)) prompt = 'F / RB — Finisher';
    }
    if (!prompt) {
      for (const f of w.room.features) {
        const near = (f.x - e.x) * (f.x - e.x) + (f.z - e.z) * (f.z - e.z) < 2.6 * 2.6;
        if (near && (f.kind === 'npc' || f.kind === 'shrine' || (f.kind === 'chest' && !f.a))) {
          prompt = `F / RB — ${NPC_LABEL[f.id] ?? (f.kind === 'chest' ? 'Open' : f.kind === 'shrine' ? 'The Well' : 'Talk')}`;
        } else if (near && f.kind === 'brazier' && !f.a) prompt = 'F / RB — Light the brazier';
        else if (near && f.kind === 'waystone' && w.zone.id !== 'citadel') prompt = 'F / RB — Waystone';
      }
    }
    this.set('prompt', prompt, () => {
      this.prompt.textContent = prompt;
      this.prompt.style.display = prompt ? 'block' : 'none';
    });
    // Target panel: the locked target, else the soft target.
    const tid = e.pl.lock || e.pl.soft;
    const t = tid && !e.dead ? w.entities.find((x) => x.id === tid && !x.dead) : null;
    this.set('target', t ? `${t.id}:${Math.ceil(t.hp)}:${(t.parts ?? []).map((pp) => (pp.broken ? 1 : 0)).join('')}:${e.pl.lock}` : '', () => {
      this.target.style.display = t ? 'block' : 'none';
      if (!t) return;
      const def = db.enemies[t.def];
      const elites = (t.elite ?? []).map((x) => db.elites[x]?.name ?? x).join(' ');
      this.targetName.textContent = `${elites ? elites + ' ' : ''}${def?.name ?? t.def}${e.pl!.lock === t.id ? '  [LOCKED]' : ''}`;
      this.targetFill.style.width = `${(100 * Math.max(0, t.hp)) / t.hpMax}%`;
      this.targetParts.textContent = (t.parts ?? []).map((pp) => `${db.enemies[t.def]?.parts.find((d) => d.id === pp.id)?.name ?? pp.id}${pp.broken ? ' ✕' : ''}`).join(' · ');
    });
    // Damage per second over the last 3 s, for the training yard.
    if (e.pl.dealt !== this.lastDealt) {
      this.dpsWindow.push({ t: w.tick, d: e.pl.dealt - this.lastDealt });
      this.lastDealt = e.pl.dealt;
    }
    this.dpsWindow = this.dpsWindow.filter((x) => w.tick - x.t < 180);
    const dps = this.dpsWindow.reduce((a, x) => a + x.d, 0) / 3;
    this.set('dps', Math.round(dps), () => {
      this.dps.textContent = dps > 0 ? `${Math.round(dps)} dps` : '';
    });
    if (this.showPerf) {
      this.perf.textContent = `${perf.fps.toFixed(0)} fps · sim ${perf.simMs.toFixed(2)} ms · ${perf.calls} calls · ${(perf.tris / 1000).toFixed(0)}k tris · ${w.entities.length} ents`;
    }
  }
}
