import type { ContentDb } from '../../core/data/types';
import type { World } from '../../core/sim/types';

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

  update(w: World, _db: ContentDb, slot: number, perf: { fps: number; simMs: number; calls: number; tris: number }): void {
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
    if (this.showPerf) {
      this.perf.textContent = `${perf.fps.toFixed(0)} fps · sim ${perf.simMs.toFixed(2)} ms · ${perf.calls} calls · ${(perf.tris / 1000).toFixed(0)}k tris · ${w.entities.length} ents`;
    }
  }
}
