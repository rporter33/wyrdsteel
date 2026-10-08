import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { dialogue, panel, version } from '../store';
import { Panel, run } from './common';
import { TRIAL_MAX, TRIAL_ZONES, bestTier, trialLevel, trialMods, trialsOpen } from '../../core/level/trials';

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
              <small>{z.level[0] === z.level[1] ? `Level ${z.level[0]}` : `Levels ${z.level[0]}–${z.level[1]}`}</small>
            </button>
          );
        })}
      </div>
      {trialsOpen(c) && <Trials />}
    </Panel>
  );
}

/** The endgame: a cleared zone as a seeded remix, one tier at a time. */
function Trials() {
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  const [tiers, setTiers] = useState<Record<string, number>>({});
  return (
    <section class="trials">
      <h3>Wyrd Trials</h3>
      <p class="muted">The Norns reweave a road you have walked: stronger foes, other foes, and hardships laid over it. Clear a tier to open the next.</p>
      <div class="stack wide">
        {TRIAL_ZONES.map((id) => {
          const z = db.zones[id]!;
          const best = bestTier(c, id);
          const tier = Math.min(tiers[id] ?? best + 1, TRIAL_MAX, best + 1);
          const mods = trialMods(db, c, id, tier);
          const set = (t: number) => setTiers({ ...tiers, [id]: Math.max(1, Math.min(best + 1, TRIAL_MAX, t)) });
          return (
            <div key={id} class="trial">
              <div class="trial-head">
                <strong>{z.name}</strong>
                <span class="muted">best: {best ? `tier ${best}` : 'none yet'}</span>
              </div>
              <div class="trial-tier">
                <button aria-label="Lower tier" disabled={tier <= 1} onClick={() => set(tier - 1)}>
                  −
                </button>
                <span>
                  Tier {tier} · foes level {trialLevel(z.level[0], tier)}–{trialLevel(z.level[1], tier)}
                </span>
                <button aria-label="Higher tier" disabled={tier >= Math.min(TRIAL_MAX, best + 1)} onClick={() => set(tier + 1)}>
                  +
                </button>
              </div>
              <ul class="mods">
                {mods.map((m) => (
                  <li key={m} class={db.trials[m]?.boon ? 'boon' : 'hard'}>
                    <b>{db.trials[m]?.name}</b> — {db.trials[m]?.desc}
                  </li>
                ))}
              </ul>
              <button class="primary" onClick={() => run({ t: 'travel', zone: id, node: '', trial: tier, mods }) && api().closePanel()}>
                Enter tier {tier}
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
