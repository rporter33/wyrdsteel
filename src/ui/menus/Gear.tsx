import { useState } from 'preact/hooks';
import { api } from '../api';
import { version } from '../store';
import { run } from './common';
import { ItemCard, RARITY_LABEL, SLOT_LABEL } from './items';
import { GEAR_SLOTS, RARITIES, type Item } from '../../core/loot/item';
import { itemName } from '../../core/loot/gear';
import { INVENTORY_SIZE } from '../../core/progression/character';

export function Gear() {
  void version.value;
  const w = api().world()!;
  const c = w.players[0]!.character;
  const db = api().db;
  const [sel, setSel] = useState<string | null>(null);
  const all: Item[] = [...c.inv, ...GEAR_SLOTS.map((s) => c.equip[s]).filter((x): x is Item => !!x)];
  const it = sel ? all.find((x) => x.uid === sel) ?? null : null;
  const equipped = it ? Object.values(c.equip).some((e) => e?.uid === it.uid) : false;
  const stats = w.players[0]!.stats;
  const runes = Object.entries(c.runes).filter(([, n]) => n > 0);
  return (
    <div class="gear">
      <div class="gear-left">
        <div class="paperdoll">
          {GEAR_SLOTS.map((s) => {
            const e = c.equip[s];
            return (
              <button key={s} class={'pd-slot' + (e ? ` r-${e.rarity}` : ' empty') + (sel && e?.uid === sel ? ' sel' : '')} onClick={() => e && setSel(e.uid)} onFocus={() => e && setSel(e.uid)}>
                <small>{SLOT_LABEL[s]}</small>
                <span>{e ? itemName(db, e) : '—'}</span>
              </button>
            );
          })}
        </div>
        <div class="statsum">
          <span>Health {stats.hpMax}</span>
          <span>Armour {stats.armor}</span>
          <span>
            Melee {stats.melee[0].toFixed(0)}–{stats.melee[1].toFixed(0)}
          </span>
          <span>
            Ranged {stats.ranged[0].toFixed(0)}–{stats.ranged[1].toFixed(0)}
          </span>
          <span>Crit {(stats.critChance * 100).toFixed(0)}%</span>
          <span>◆ {c.bounty}</span>
          {Object.entries(c.mats).filter(([, n]) => n > 0).map(([k, n]) => (
            <span key={k}>
              {k.replace('mat.', '')} {n}
            </span>
          ))}
        </div>
        <div class="bag-head">
          Bag {c.inv.length}/{INVENTORY_SIZE}
          <button onClick={() => run({ t: 'salvage', uids: c.inv.filter((x) => x.rarity === 'worn' || x.rarity === 'forged').map((x) => x.uid) })}>Salvage worn & forged</button>
        </div>
        <div class="bag">
          {c.inv.map((x) => (
            <button key={x.uid} class={`bag-item r-${x.rarity}` + (sel === x.uid ? ' sel' : '')} title={itemName(db, x)} onClick={() => setSel(x.uid)} onFocus={() => setSel(x.uid)}>
              {itemName(db, x)}
            </button>
          ))}
          {!c.inv.length && <p class="muted">Empty. Loot drops are picked up as you walk over them.</p>}
        </div>
        <AutoSalvage />
      </div>
      <div class="gear-right">
        {it ? (
          <>
            <ItemCard it={it} c={c} compare={!equipped} />
            <div class="row">
              {!equipped && <button class="primary" onClick={() => run({ t: 'equip', uid: it.uid })}>Equip</button>}
              {equipped && db.bases[it.base]!.slot !== 'melee' && db.bases[it.base]!.slot !== 'ranged' && <button onClick={() => run({ t: 'unequip', slot: db.bases[it.base]!.slot })}>Unequip</button>}
              {!equipped && (
                <button
                  onClick={() => {
                    run({ t: 'salvage', uids: [it.uid] });
                    setSel(null);
                  }}
                >
                  Salvage
                </button>
              )}
            </div>
            {it.sockets.some((s) => s === null) && runes.length > 0 && (
              <div class="socket-pick">
                <small>Carve a rune into the first empty socket (permanent):</small>
                {runes.map(([r, n]) => (
                  <button key={r} onClick={() => run({ t: 'socket', uid: it.uid, rune: r, idx: it.sockets.indexOf(null) })}>
                    {db.runes[r]?.name} ×{n}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p class="muted">Select an item to see it, compare it and act on it.</p>
        )}
        {c.recentSalvage.length > 0 && (
          <div class="recent">
            <small>Recently salvaged — undo returns the item and takes back what it gave:</small>
            {[...c.recentSalvage].reverse().map((x) => (
              <button key={x.uid} class={`r-${x.rarity}`} onClick={() => run({ t: 'unsalvage', uid: x.uid })}>
                ↶ {itemName(db, x)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AutoSalvage() {
  const c = api().world()!.players[0]!.character;
  const r = c.autoSalvage;
  const set = (patch: Partial<typeof r>) => run({ t: 'setAutoSalvage', ...r, ...patch });
  return (
    <div class="autosalvage">
      <small>Auto-salvage on pickup</small>
      <label>
        Up to
        <select value={String(r.maxRarity)} onChange={(e) => set({ maxRarity: Number((e.target as HTMLSelectElement).value) })}>
          <option value="-1">off</option>
          {RARITIES.slice(0, 3).map((x, i) => (
            <option key={x} value={String(i)}>
              {RARITY_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={r.onlyIfWorse} onChange={(e) => set({ onlyIfWorse: (e.target as HTMLInputElement).checked })} /> only if worse than equipped
      </label>
      <label>
        <input type="checkbox" checked={r.keepSockets > 0} onChange={(e) => set({ keepSockets: (e.target as HTMLInputElement).checked ? 2 : 0 })} /> keep items with 2+ sockets
      </label>
    </div>
  );
}
