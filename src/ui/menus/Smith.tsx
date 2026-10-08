import { api } from '../api';
import { version } from '../store';
import { Panel, run } from './common';
import { itemName } from '../../core/loot/gear';
import { RARITY_LABEL } from './items';

/** Brokkr: blueprints to craft, sockets to cut. */
export function Smith() {
  void version.value;
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  const all = [...c.inv, ...Object.values(c.equip).filter((x): x is NonNullable<typeof x> => !!x)];
  return (
    <Panel title="Brokkr's smithy" wide>
      <p class="lore">"Bring me iron and I'll bring you a reason to keep it."</p>
      <p class="muted">
        ◆ {c.bounty} · iron {c.mats['mat.iron'] ?? 0} · rune-dust {c.mats['mat.rune'] ?? 0} · starmetal {c.mats['mat.star'] ?? 0}
      </p>
      <h3>Blueprints</h3>
      <div class="quests">
        {c.blueprints.length === 0 && <p class="muted">No blueprints yet. They turn up in chests and Wells of Wyrd.</p>}
        {c.blueprints.map((id) => {
          const bp = db.blueprints[id]!;
          return (
            <div key={id} class={`quest r-${bp.rarity}`}>
              <strong>{bp.name}</strong>
              <small>
                {RARITY_LABEL[bp.rarity]} {db.bases[bp.base]?.name}
              </small>
              <small>Always rolls: {bp.guaranteed.map((g) => db.affixes.find((a) => a.id === g)?.name).join(', ')}</small>
              <small>
                Costs ◆ {bp.bounty}, {Object.entries(bp.mats).map(([k, n]) => `${n} ${k.replace('mat.', '')}`).join(', ')}
              </small>
              <button onClick={() => run({ t: 'craft', blueprint: id })}>Forge</button>
            </div>
          );
        })}
      </div>
      <h3>Cut a socket</h3>
      <div class="bag">
        {all
          .filter((x) => ['melee', 'ranged', 'chest', 'helm'].includes(db.bases[x.base]!.slot) && x.sockets.length < 3)
          .map((x) => (
            <button key={x.uid} class={`bag-item r-${x.rarity}`} onClick={() => run({ t: 'addSocket', uid: x.uid })}>
              {itemName(db, x)} ({x.sockets.length}→{x.sockets.length + 1}) · ◆ {80 * (x.sockets.length + 1) * (1 + Math.floor(x.ilvl / 5))}
            </button>
          ))}
      </div>
    </Panel>
  );
}

/** The rune-carver: fuse three runes into one of the next tier. */
export function Carver() {
  void version.value;
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  const runes = Object.entries(c.runes).filter(([, n]) => n > 0);
  return (
    <Panel title="Rune-carver">
      <p class="muted">Three runes of a kind fuse into one of the next tier. Carve runes into sockets from the Gear tab.</p>
      <div class="stack wide">
        {!runes.length && <p class="muted">You carry no runes.</p>}
        {runes.map(([r, n]) => (
          <div key={r} class="row">
            <span class="grow">
              {db.runes[r]?.name} ×{n} — {db.runes[r]?.stats.map((s) => `${s.stat} ${s.amt}`).join(', ')}
            </span>
            <button disabled={n < 3} onClick={() => run({ t: 'fuseRunes', rune: r })}>
              Fuse 3
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The shared stash: sixty slots every character can reach. */
export function Stash() {
  void version.value;
  const db = api().db;
  const w = api().world()!;
  const c = w.players[0]!.character;
  return (
    <Panel title="Stash" wide>
      <div class="two-col">
        <div>
          <h3>Bag</h3>
          <div class="bag">
            {c.inv.map((x) => (
              <button key={x.uid} class={`bag-item r-${x.rarity}`} onClick={() => run({ t: 'stash', uid: x.uid, dir: 'in' })}>
                {itemName(db, x)} →
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3>Stash {w.stash.length}/60</h3>
          <div class="bag">
            {w.stash.map((x) => (
              <button key={x.uid} class={`bag-item r-${x.rarity}`} onClick={() => run({ t: 'stash', uid: x.uid, dir: 'out' })}>
                ← {itemName(db, x)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
