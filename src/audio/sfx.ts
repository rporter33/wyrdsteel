import type { SimEvent, World } from '../core/sim/types';
import type { AudioEngine } from './engine';

/** Sim events in, sounds out. `pan` maps an entity's screen side to stereo position. */
export function playEvents(a: AudioEngine, w: World, events: SimEvent[], pan: (x: number, z: number) => number): void {
  if (!a.ready) return;
  const ent = (id: number) => w.entities.find((e) => e.id === id);
  for (const ev of events) {
    switch (ev.k) {
      case 'swing': {
        if (!a.gate('swing', 40)) break;
        const e = ent(ev.src);
        const p = e ? pan(e.x, e.z) : 0;
        a.noiseBurst({ dur: 0.14, gain: 0.18, f0: 2400, f1: 700, q: 0.8, pan: p });
        break;
      }
      case 'hit': {
        const p = pan(ev.x, ev.z);
        if (ev.dmg === 0) {
          if (!a.gate('block', 50)) break;
          a.tone({ type: 'square', f0: 820, f1: 780, dur: 0.12, gain: 0.08, pan: p });
          a.tone({ type: 'triangle', f0: 1240, dur: 0.18, gain: 0.07, pan: p });
          break;
        }
        const target = ent(ev.dst);
        if (target?.kind === 'player') {
          if (!a.gate('hurt', 60)) break;
          a.tone({ type: 'sawtooth', f0: 180, f1: 70, dur: 0.18, gain: 0.16, pan: p });
          a.noiseBurst({ dur: 0.1, gain: 0.2, f0: 900, type: 'lowpass', pan: p });
          break;
        }
        if (ev.status === 'burn' && !a.gate('burn', 120)) break;
        if (!a.gate(ev.heavy ? 'heavyhit' : 'hit', ev.heavy ? 50 : 25)) break;
        a.noiseBurst({ dur: ev.heavy ? 0.16 : 0.08, gain: ev.heavy ? 0.32 : 0.22, f0: ev.heavy ? 1400 : 2200, f1: 400, q: 1.2, pan: p });
        a.tone({ f0: ev.heavy ? 140 : 190, f1: 50, dur: ev.heavy ? 0.22 : 0.1, gain: ev.heavy ? 0.4 : 0.22, pan: p });
        if (ev.crit) a.tone({ type: 'triangle', f0: 1760, f1: 1500, dur: 0.12, gain: 0.08, pan: p, delay: 0.02 });
        if (ev.weak) a.tone({ type: 'square', f0: 620, f1: 300, dur: 0.1, gain: 0.06, pan: p });
        break;
      }
      case 'shoot': {
        const e = ent(ev.src);
        const p = e ? pan(e.x, e.z) : 0;
        if (e?.kind !== 'player') {
          if (!a.gate('eshoot', 70)) break;
          a.tone({ type: 'triangle', f0: 520, f1: 180, dur: 0.12, gain: 0.07, pan: p });
          break;
        }
        if (!a.gate('shoot:' + ev.weapon, 30)) break;
        if (ev.weapon === 'shell' || ev.weapon === 'grenade') {
          a.tone({ f0: 110, f1: 35, dur: 0.35, gain: 0.45, pan: p });
          a.noiseBurst({ dur: 0.3, gain: 0.25, f0: 600, f1: 120, type: 'lowpass', pan: p });
        } else if (ev.weapon === 'slug') {
          a.tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.3, gain: 0.25, pan: p });
          a.noiseBurst({ dur: 0.2, gain: 0.3, f0: 3000, f1: 300, pan: p });
        } else {
          a.noiseBurst({ dur: 0.06, gain: 0.22, f0: ev.weapon === 'round' ? 1800 : 3200, f1: 500, q: 0.7, pan: p });
          a.tone({ type: 'square', f0: ev.weapon === 'round' ? 240 : 380, f1: 90, dur: 0.07, gain: 0.08, pan: p });
        }
        break;
      }
      case 'dodge':
        if (ev.perfect) {
          a.tone({ f0: 1320, dur: 0.35, gain: 0.12 });
          a.tone({ f0: 1980, dur: 0.45, gain: 0.08, delay: 0.04 });
        } else if (a.gate('dodge', 80)) a.noiseBurst({ dur: 0.22, gain: 0.12, f0: 800, f1: 2400, q: 0.6 });
        break;
      case 'launch':
        if (a.gate('launch', 60)) a.tone({ type: 'triangle', f0: 220, f1: 660, dur: 0.2, gain: 0.12 });
        break;
      case 'land':
        if (ev.slam && a.gate('slam', 60)) {
          a.tone({ f0: 90, f1: 30, dur: 0.3, gain: 0.4 });
          a.noiseBurst({ dur: 0.25, gain: 0.2, f0: 400, type: 'lowpass' });
        }
        break;
      case 'death': {
        if (!a.gate('death', 40)) break;
        const p = pan(ev.x, ev.z);
        a.tone({ type: 'sawtooth', f0: 240, f1: 50, dur: 0.45, gain: 0.12, pan: p });
        a.noiseBurst({ dur: 0.35, gain: 0.15, f0: 1200, f1: 200, pan: p });
        break;
      }
      case 'partBreak':
        a.noiseBurst({ dur: 0.4, gain: 0.35, f0: 900, f1: 120, q: 0.5 });
        a.tone({ type: 'square', f0: 160, f1: 40, dur: 0.35, gain: 0.15 });
        break;
      case 'shatter':
        for (let i = 0; i < 4; i++) a.tone({ type: 'triangle', f0: 2200 + i * 400, dur: 0.2, gain: 0.05, delay: i * 0.03 });
        break;
      case 'status':
        if (ev.status === 'freeze') a.tone({ type: 'triangle', f0: 1600, f1: 2400, dur: 0.3, gain: 0.08 });
        else if (ev.status === 'shock' && a.gate('shock', 80)) a.noiseBurst({ dur: 0.15, gain: 0.2, f0: 5000, q: 4 });
        else if (ev.status === 'root' && a.gate('root', 80)) a.tone({ type: 'square', f0: 140, dur: 0.2, gain: 0.08 });
        break;
      case 'hazard':
        if (ev.what.startsWith('blast') && a.gate('blast', 60)) {
          a.tone({ f0: 80, f1: 25, dur: 0.5, gain: 0.5, pan: pan(ev.x, ev.z) });
          a.noiseBurst({ dur: 0.45, gain: 0.3, f0: 700, f1: 80, type: 'lowpass', pan: pan(ev.x, ev.z) });
        }
        break;
      case 'ability':
        if (ev.id === 'flask') a.tone({ type: 'sine', f0: 440, f1: 880, dur: 0.3, gain: 0.1 });
        else a.tone({ type: 'triangle', f0: 330, f1: 660, dur: 0.18, gain: 0.08 });
        break;
      case 'ruiner':
        a.tone({ type: 'sawtooth', f0: 60, f1: 30, dur: 0.9, gain: 0.35 });
        a.noiseBurst({ dur: 0.8, gain: 0.3, f0: 300, f1: 3000, q: 0.5 });
        break;
      case 'pickup':
        if (a.gate('pickup', 40)) a.tone({ type: 'triangle', f0: ev.kind === 'bounty' ? 1400 : 990, dur: 0.12, gain: 0.07 });
        break;
      case 'levelUp':
        [523, 659, 784, 1046].forEach((f, i) => a.tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.09, delay: i * 0.08 }));
        break;
      case 'telegraph':
        if (a.gate('tele', 120)) a.tone({ type: 'sine', f0: 300, f1: 420, dur: 0.18, gain: 0.05 });
        break;
      case 'boss':
        if (ev.what === 'phase' && ev.value !== '1') {
          a.tone({ type: 'sawtooth', f0: 70, f1: 32, dur: 1.4, gain: 0.35 });
          a.noiseBurst({ dur: 1.2, gain: 0.25, f0: 400, f1: 90, type: 'lowpass' });
        } else if (ev.what === 'phase') a.tone({ type: 'sawtooth', f0: 55, f1: 45, dur: 1.6, gain: 0.25 });
        else if (ev.what === 'broken') {
          a.noiseBurst({ dur: 0.6, gain: 0.35, f0: 3200, f1: 500, q: 0.7 });
          a.tone({ type: 'triangle', f0: 300, f1: 90, dur: 0.5, gain: 0.2 });
        } else if (ev.what === 'plated') [180, 220, 260].forEach((f, i) => a.tone({ type: 'triangle', f0: f, dur: 0.12, gain: 0.12, delay: i * 0.09 }));
        else if (ev.what === 'exposed') {
          a.noiseBurst({ dur: 1.2, gain: 0.22, f0: 1500, f1: 6000, type: 'highpass' });
          a.tone({ type: 'sine', f0: 200, f1: 620, dur: 0.9, gain: 0.12 });
        } else if (ev.what === 'channel') a.tone({ type: 'sine', f0: 110, f1: 140, dur: 1.2, gain: 0.12 });
        else if (ev.what === 'interrupt') a.noiseBurst({ dur: 0.3, gain: 0.3, f0: 2500, f1: 400, q: 1 });
        else if (ev.what === 'collapse') a.noiseBurst({ dur: 2, gain: 0.35, f0: 300, f1: 60, type: 'lowpass' });
        else if (ev.what === 'defeated') {
          a.tone({ type: 'sawtooth', f0: 90, f1: 20, dur: 2.6, gain: 0.35 });
          a.noiseBurst({ dur: 2.4, gain: 0.3, f0: 600, f1: 50, type: 'lowpass' });
          [523, 659, 784].forEach((f, i) => a.tone({ type: 'triangle', f0: f, dur: 1.2, gain: 0.08, delay: 1.6 + i * 0.25 }));
        }
        break;
      case 'playerDown':
        [392, 330, 262].forEach((f, i) => a.tone({ type: 'sine', f0: f, dur: 0.6, gain: 0.1, delay: i * 0.18 }));
        break;
    }
  }
}

export function uiClick(a: AudioEngine): void {
  if (a.gate('ui', 30)) a.tone({ type: 'triangle', f0: 660, dur: 0.05, gain: 0.05 });
}
