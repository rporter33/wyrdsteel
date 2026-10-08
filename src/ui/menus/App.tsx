import { useState } from 'preact/hooks';
import { screen, panel, toasts } from '../store';
import { api } from '../api';
import { Pause } from './Pause';
import { Character } from './Character';
import { Well, Board } from './Npcs';
import { Controls } from './Controls';
import { Smith, Carver, Stash } from './Smith';

export function App() {
  const s = screen.value;
  return (
    <>
      {s === 'title' && <Title />}
      {s === 'newgame' && <NewGame />}
      {s === 'game' && panel.value === 'pause' && <Pause />}
      {s === 'game' && panel.value === 'skills' && <Character />}
      {s === 'game' && panel.value === 'inventory' && <Character initial="gear" />}
      {s === 'game' && panel.value === 'well' && <Well />}
      {s === 'game' && panel.value === 'board' && <Board />}
      {s === 'game' && panel.value === 'controls' && <Controls />}
      {s === 'game' && panel.value === 'smith' && <Smith />}
      {s === 'game' && panel.value === 'carver' && <Carver />}
      {s === 'game' && panel.value === 'stash' && <Stash />}
      <Toasts />
    </>
  );
}

function Title() {
  return (
    <div class="screen title-screen">
      <div class="title-card">
        <h1 class="logo">WYRDSTEEL</h1>
        <p class="tagline">The winter has lasted an age. The gods are soldiers now, rebuilt by machine.</p>
        <div class="stack">
          <button class="primary" autofocus onClick={() => (screen.value = 'newgame')} data-testid="new-game">
            New game
          </button>
        </div>
        <p class="fine">Keyboard and mouse or a gamepad. Saves stay in this browser.</p>
      </div>
    </div>
  );
}

function NewGame() {
  const db = api().db;
  const classes = Object.values(db.classes);
  const [cls, setCls] = useState(classes[0]!.id);
  const [name, setName] = useState('Sworn');
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
        <div class="row end">
          <button onClick={() => (screen.value = 'title')}>Back</button>
          <button class="primary" data-testid="begin" onClick={() => api().newGame(name.trim() || 'Sworn', cls)}>
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
