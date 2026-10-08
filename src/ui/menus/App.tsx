import { useRef, useState } from 'preact/hooks';
import { screen, panel, toasts, version } from '../store';
import { api } from '../api';
import { Pause } from './Pause';
import { Character } from './Character';
import { Well, Board } from './Npcs';
import { Controls } from './Controls';
import { Smith, Carver, Stash } from './Smith';
import { SettingsView } from './Settings';
import { Dialogue, Gate, Waystone } from './Story';
import { Codex } from './Codex';

export function App() {
  const s = screen.value;
  const p = panel.value;
  return (
    <>
      {s === 'title' && <Title />}
      {s === 'newgame' && <NewGame />}
      {s === 'load' && <Load />}
      {s === 'settings' && <SettingsView onBack={() => (screen.value = 'title')} />}
      {s === 'game' && p === 'pause' && <Pause />}
      {s === 'game' && p === 'settings' && <SettingsView onBack={() => (panel.value = 'pause')} />}
      {s === 'game' && p === 'skills' && <Character />}
      {s === 'game' && p === 'inventory' && <Character initial="gear" />}
      {s === 'game' && p === 'well' && <Well />}
      {s === 'game' && p === 'board' && <Board />}
      {s === 'game' && p === 'controls' && <Controls />}
      {s === 'game' && p === 'smith' && <Smith />}
      {s === 'game' && p === 'carver' && <Carver />}
      {s === 'game' && p === 'stash' && <Stash />}
      {s === 'game' && p === 'dialogue' && <Dialogue />}
      {s === 'game' && p === 'gate' && <Gate />}
      {s === 'game' && p === 'waystone' && <Waystone />}
      {s === 'game' && p === 'skald' && <Codex />}
      <Toasts />
    </>
  );
}

function fmtPlay(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function Title() {
  void version.value;
  const slots = api().slots();
  const used = slots.filter((s) => s.name);
  const latest = [...used].sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1))[0];
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  return (
    <div class="screen title-screen">
      <div class="title-card">
        <h1 class="logo">WYRDSTEEL</h1>
        <p class="tagline">The winter has lasted an age. The gods are soldiers now, rebuilt by machine.</p>
        <div class="stack">
          {latest && (
            <button class="primary" autofocus onClick={() => api().loadSlot(latest.slot)} data-testid="continue">
              Continue — {latest.name}, level {latest.level}
            </button>
          )}
          <button class={latest ? '' : 'primary'} autofocus={!latest} onClick={() => (screen.value = 'newgame')} data-testid="new-game">
            New game
          </button>
          {used.length > 0 && <button onClick={() => (screen.value = 'load')}>Load</button>}
          <button onClick={() => (screen.value = 'settings')}>Settings</button>
          <button onClick={() => file.current?.click()}>Import save</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              const r = await api().importSave(await f.text());
              setMsg(r.ok ? `Imported.${r.skipped.length ? ` ${r.skipped.length} things couldn't be restored: ${r.skipped.slice(0, 4).join('; ')}${r.skipped.length > 4 ? '…' : ''}` : ''}` : `Import failed: ${r.message}`);
            }}
          />
        </div>
        {msg && <p class="fine">{msg}</p>}
        <p class="fine">Keyboard and mouse or a gamepad. Saves stay in this browser ({api().saveStatus().storage}); export a copy from the pause menu.</p>
      </div>
    </div>
  );
}

function Load() {
  void version.value;
  return (
    <div class="screen">
      <div class="panel">
        <h2>Load</h2>
        <div class="stack wide">
          {api()
            .slots()
            .map((s) => (
              <div key={s.slot} class="row">
                <button class="grow slot-btn" disabled={!s.name} onClick={() => api().loadSlot(s.slot)}>
                  {s.name ? (
                    <>
                      <strong>{s.name}</strong> · {s.cls} {s.level} · {s.where} · {fmtPlay(s.playMs)}
                    </>
                  ) : (
                    `Slot ${s.slot + 1}: empty`
                  )}
                </button>
                {s.name && (
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${s.name}? This can't be undone (export first if unsure).`)) void api().deleteSlot(s.slot);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
        </div>
        <div class="row end">
          <button onClick={() => (screen.value = 'title')}>Back</button>
        </div>
      </div>
    </div>
  );
}

function NewGame() {
  const db = api().db;
  const classes = Object.values(db.classes);
  const slots = api().slots();
  const firstFree = slots.find((s) => !s.name)?.slot ?? -1;
  const [cls, setCls] = useState(classes[0]!.id);
  const [name, setName] = useState('Sworn');
  const [slot, setSlot] = useState(firstFree >= 0 ? firstFree : 0);
  const overwriting = slots[slot]?.name;
  return (
    <div class="screen">
      <div class="panel wide">
        <h2>Choose your calling</h2>
        <div class="class-grid">
          {classes.map((c) => (
            <button key={c.id} class={'class-card' + (c.id === cls ? ' selected' : '')} onClick={() => setCls(c.id)} data-testid={`class-${c.id}`} aria-pressed={c.id === cls}>
              <strong>{c.name}</strong>
              <span>{c.blurb}</span>
              <small>
                {c.hp} HP · {db.weapons[c.startMelee]?.name ?? c.startMelee} + {db.weapons[c.startRanged]?.name ?? c.startRanged}
              </small>
            </button>
          ))}
        </div>
        <label class="field">
          Name
          <input value={name} maxLength={18} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          Save slot
          <select value={String(slot)} onChange={(e) => setSlot(Number((e.target as HTMLSelectElement).value))}>
            {slots.map((s) => (
              <option key={s.slot} value={String(s.slot)}>
                Slot {s.slot + 1}: {s.name ? `${s.name} (will be replaced)` : 'empty'}
              </option>
            ))}
          </select>
        </label>
        {overwriting && <p class="warn">Starting here replaces {overwriting}.</p>}
        <div class="row end">
          <button onClick={() => (screen.value = 'title')}>Back</button>
          <button class="primary" data-testid="begin" onClick={() => api().newGame(name.trim() || 'Sworn', cls, slot)}>
            Begin
          </button>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  return (
    <div class="toast-stack" role="status">
      {toasts.value.map((t) => (
        <div key={t.id} class={'toast ' + t.kind}>
          <span>{t.text}</span>
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
