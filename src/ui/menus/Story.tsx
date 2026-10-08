import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { dialogue, panel, version } from '../store';
import { Panel, run } from './common';

/** Story beats: one line at a time; click, Enter, Space or A advances. */
export function Dialogue() {
  const beats = dialogue.value;
  const [line, setLine] = useState(0);
  const db = api().db;
  const beat = beats[0] ? db.story[beats[0]] : null;
  const w = api().world();
  const name = w?.players[0]?.character.name ?? 'Sworn';
  const align = w?.players[0]?.character.alignment;
  const next = () => {
    if (!beat) return;
    if (line + 1 < beat.lines.length) setLine(line + 1);
    else {
      setLine(0);
      dialogue.value = beats.slice(1);
      if (beats.length <= 1) api().closePanel();
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  if (!beat) return null;
  const l = beat.lines[line]!;
  const text = ((align === 'human' && l.human) || (align === 'cyber' && l.cyber) || l.text).replaceAll('{name}', name);
  const who = l.who.replaceAll('{name}', name);
  return (
    <div class="screen dialogue-screen" onClick={next}>
      <div class="dialogue">
        <div class="who">{who}</div>
        <p>{text}</p>
        <button class="primary" autofocus onClick={(e) => (e.stopPropagation(), next())}>
          {line + 1 < beat.lines.length || beats.length > 1 ? 'Continue' : 'Close'}
        </button>
      </div>
    </div>
  );
}

/** Heimdall's gate: travel to any zone the story has opened. */
export function Gate() {
  void version.value;
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  const zones = Object.values(db.zones).filter((z) => z.travel);
  return (
    <Panel title="The Bifrost gate">
      <p class="lore">"Where, Sworn? The bridge goes where the story has gone."</p>
      <div class="stack wide">
        {zones.map((z) => {
          const open = !z.requires || !!c.story[z.requires];
          const done = !!c.story[`zone.${z.id}`];
          return (
            <button key={z.id} class="zone-btn" disabled={!open} onClick={() => run({ t: 'travel', zone: z.id, node: '' }) && api().closePanel()}>
              <strong>
                {z.name} {done && <small>· cleared</small>}
              </strong>
              <span>{open ? z.desc : 'Not yet. The story has not reached it.'}</span>
              <small>
                Levels {z.level[0]}–{z.level[1]}
              </small>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/** A waystone outside the citadel: rest here, or go home. */
export function Waystone() {
  return (
    <Panel title="Waystone">
      <p class="muted">Attuned. You'll return here if you fall, and the game has saved.</p>
      <div class="stack">
        <button
          class="primary"
          onClick={() => {
            if (run({ t: 'travel', zone: 'citadel', node: 'hub' })) panel.value = null;
          }}
        >
          Return to Gladsheim
        </button>
        <button onClick={() => api().closePanel()}>Stay</button>
      </div>
    </Panel>
  );
}
