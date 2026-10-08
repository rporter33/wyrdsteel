import { api } from '../api';
import { version } from '../store';
import { Panel, run } from './common';
import { respecCost, swapCost } from '../../core/progression/skills';

/** Idunn's Well: respec, choose an aspect (once the story allows), swap aspects. */
export function Well() {
  void version.value;
  const w = api().world()!;
  const c = w.players[0]!.character;
  const offered = (c.story['align.offer'] ?? 0) > 0 || w.room.id === 'training';
  const rc = respecCost(c);
  const sc = swapCost(c);
  return (
    <Panel title="Idunn's Well">
      <p class="lore">"The well remembers every shape you have worn. Drink, and choose again."</p>
      <div class="stack wide">
        <button onClick={() => run({ t: 'respec' })}>Respec skills — {rc ? `${rc} bounty` : 'free'}</button>
        {!c.alignment && offered && (
          <>
            <p class="muted">Choose your aspect. You can swap later, here, and each aspect keeps its own points.</p>
            <button class="aspect human" onClick={() => run({ t: 'chooseAlignment', a: 'human' })}>
              <strong>Idunn's ritual — stay Human</strong>
              <span>Speed, longer combos, crits, a third dodge.</span>
            </button>
            <button class="aspect cyber" onClick={() => run({ t: 'chooseAlignment', a: 'cyber' })}>
              <strong>Brokkr's forge — become Cyber</strong>
              <span>Plating, raw damage, a heavy laser, faster Ruin.</span>
            </button>
          </>
        )}
        {c.alignment && (
          <button onClick={() => run({ t: 'swapAspect' })}>
            Swap to {c.alignment === 'human' ? 'Cyber' : 'Human'} aspect — {sc ? `${sc} bounty` : 'free'}
          </button>
        )}
      </div>
    </Panel>
  );
}

/** The quest board: charm quests. */
export function Board() {
  void version.value;
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  return (
    <Panel title="Quest board" wide>
      <p class="muted">Each charm quest teaches a way to fight. Up to three at a time. Finishing one grants the charm and a skill point.</p>
      <div class="quests">
        {Object.values(db.charms).map((ch) => {
          const q = c.charms.find((x) => x.id === ch.id);
          return (
            <div key={ch.id} class={'quest' + (q?.done ? ' done' : '')}>
              <strong>{ch.name}</strong> <small>{db.ruiners[ch.ruiner]?.name}: {db.ruiners[ch.ruiner]?.desc}</small>
              {ch.quests.map((s, i) => (
                <div key={i} class="qstep">
                  {s.text} {q && <b>{Math.min(q.progress[i] ?? 0, s.count)}/{s.count}</b>}
                </div>
              ))}
              {!q && <button onClick={() => run({ t: 'takeQuest', charm: ch.id })}>Take quest</button>}
              {q?.done && <em>Complete</em>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
