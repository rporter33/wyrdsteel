import { useState } from 'preact/hooks';
import { api } from '../api';
import type { Settings } from '../../core/save/schema';
import { DEFAULT_KEYS } from '../../platform/input/bindings';
import type { ButtonName } from '../../core/input/frame';

const LABELS: Partial<Record<ButtonName, string>> = {
  light: 'Light attack',
  heavy: 'Heavy attack',
  launcher: 'Launcher',
  dodge: 'Dodge',
  fire: 'Fire',
  precise: 'Precise aim',
  ab1: 'Ability 1',
  ab2: 'Ability 2',
  ab3: 'Ability 3',
  ab4: 'Ability 4',
  ruiner: 'Ruiner',
  interact: 'Interact / finisher',
  lock: 'Lock on',
  flask: 'Flask',
};

export function SettingsView(props: { onBack: () => void }) {
  const [s, setS] = useState<Settings>(structuredClone(api().settings()));
  const [binding, setBinding] = useState<ButtonName | null>(null);
  const set = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    void api().setSettings(next);
  };
  const keysFor = (b: ButtonName) => s.keys[b] ?? DEFAULT_KEYS[b];
  const pretty = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('Mouse0', 'Left mouse').replace('Mouse2', 'Right mouse').replace('ShiftLeft', 'Shift');
  return (
    <div class="screen dim">
      <div class="panel wide">
        <h2>Settings</h2>
        <div class="settings">
          <h3>Gameplay</h3>
          <label>
            Aim assist <b>{Math.round(s.assist * 100)}%</b>
            <input type="range" min="0" max="1" step="0.05" value={s.assist} onInput={(e) => set({ assist: Number((e.target as HTMLInputElement).value) })} />
            <small>How far melee reaches for a nearby target, and gamepad shot magnetism. 0% means exactly where you aim.</small>
          </label>
          <label>
            Difficulty
            <select value={String(s.difficulty)} onChange={(e) => set({ difficulty: Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2 })}>
              <option value="0">Story — enemies hit softer and fall faster</option>
              <option value="1">Normal</option>
              <option value="2">Hard — tougher foes, one more attacker at a time</option>
            </select>
            <small>Applies to new characters and the next zone you enter.</small>
          </label>
          <h3>Camera and comfort</h3>
          <label>
            Camera distance <b>{s.cameraDistance} m</b>
            <input type="range" min="14" max="26" step="1" value={s.cameraDistance} onInput={(e) => set({ cameraDistance: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>
            Camera pitch <b>{s.cameraPitch}°</b>
            <input type="range" min="45" max="65" step="1" value={s.cameraPitch} onInput={(e) => set({ cameraPitch: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>
            Screen shake <b>{Math.round(s.shake * 100)}%</b>
            <input type="range" min="0" max="1" step="0.1" value={s.shake} onInput={(e) => set({ shake: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="check">
            <input type="checkbox" checked={s.flash} onChange={(e) => set({ flash: (e.target as HTMLInputElement).checked })} /> Hit flashes
          </label>
          <label class="check">
            <input type="checkbox" checked={s.reducedMotion} onChange={(e) => set({ reducedMotion: (e.target as HTMLInputElement).checked })} /> Reduced motion (no shake, no flashes)
          </label>
          <h3>Graphics</h3>
          <label>
            Quality{' '}
            <select value={s.quality} onChange={(e) => set({ quality: (e.target as HTMLSelectElement).value })}>
              <option value="auto">Auto (guess from your GPU)</option>
              <option value="low">Low: integrated graphics, battery</option>
              <option value="medium">Medium: shadows, bloom, textures</option>
              <option value="high">High: ambient occlusion, sharper shadows</option>
              <option value="ultra">Ultra: full resolution, 4K shadows</option>
            </select>
          </label>
          <h3>Sound and display</h3>
          <label>
            Volume <b>{Math.round(s.volume * 100)}%</b>
            <input type="range" min="0" max="1" step="0.05" value={s.volume} onInput={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>
            Music <b>{Math.round(s.music * 100)}%</b>
            <input type="range" min="0" max="1" step="0.05" value={s.music} onInput={(e) => set({ music: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>
            Text size <b>{Math.round(s.textScale * 100)}%</b>
            <input type="range" min="1" max="1.3" step="0.15" value={s.textScale} onInput={(e) => set({ textScale: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label class="check">
            <input type="checkbox" checked={s.boldTelegraphs} onChange={(e) => set({ boldTelegraphs: (e.target as HTMLInputElement).checked })} /> Bold telegraphs (brighter, more opaque warning areas)
          </label>
          <label class="check">
            <input type="checkbox" checked={s.showPerf} onChange={(e) => set({ showPerf: (e.target as HTMLInputElement).checked })} /> Show performance overlay
          </label>
          <h3>Gamepad</h3>
          <label>
            Stick deadzone <b>{Math.round(s.deadzone * 100)}%</b>
            <input type="range" min="0.05" max="0.4" step="0.01" value={s.deadzone} onInput={(e) => set({ deadzone: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <h3>Keyboard</h3>
          <div class="keys">
            {(Object.keys(LABELS) as ButtonName[]).map((b) => (
              <div key={b} class="row">
                <span class="grow">{LABELS[b]}</span>
                <button
                  class={binding === b ? 'armed' : ''}
                  onClick={() => setBinding(b)}
                  onKeyDown={(e) => {
                    if (binding !== b || e.key === 'Tab') return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      setBinding(null);
                      return;
                    }
                    set({ keys: { ...s.keys, [b]: [e.code] } });
                    setBinding(null);
                  }}
                  onMouseDown={(e) => {
                    if (binding !== b) return;
                    e.preventDefault();
                    set({ keys: { ...s.keys, [b]: [`Mouse${e.button}`] } });
                    setBinding(null);
                  }}
                >
                  {binding === b ? 'Press a key or click…' : keysFor(b).map(pretty).join(' / ')}
                </button>
              </div>
            ))}
            <button onClick={() => set({ keys: {} })}>Reset keys to defaults</button>
          </div>
        </div>
        <div class="row end">
          <button class="primary" onClick={props.onBack}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
