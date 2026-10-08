import { useState } from 'preact/hooks';
import { api } from '../api';
import { version } from '../store';
import { Panel, Tabs, run } from './common';
import { Gear } from './Gear';
import { allocFor, budgetFor, canRank, spent, treeFor, unlockedAbilities, aspectPoints } from '../../core/progression/skills';
import { boundAbilities } from '../../core/combat/attack';
import type { TreeDef } from '../../core/data/types';
import type { CharacterState } from '../../core/progression/character';

type Tab = 'gear' | 'skills' | 'aspect' | 'abilities' | 'charms';
let lastTab: Tab = 'skills';

export function Character(props: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(props.initial ?? lastTab);
  void version.value;
  const w = api().world();
  if (!w) return null;
  const p = w.players[0]!;
  const c = p.character;
  const change = (t: Tab) => {
    lastTab = t;
    setTab(t);
  };
  return (
    <Panel title={`${c.name} — ${api().db.classes[c.cls]?.name ?? c.cls}, level ${c.level}`} wide>
      <Tabs
        tabs={[
          { id: 'gear', label: 'Gear' },
          { id: 'skills', label: 'Skills' },
          { id: 'aspect', label: 'Aspect' },
          { id: 'abilities', label: 'Abilities' },
          { id: 'charms', label: 'Charms' },
        ]}
        value={tab}
        onChange={change}
      />
      {tab === 'gear' && <Gear />}
      {tab === 'skills' && <TreeView tree={treeFor(api().db, c, 'cls')} which="cls" c={c} />}
      {tab === 'aspect' && (c.alignment ? <TreeView tree={treeFor(api().db, c, c.alignment)} which={c.alignment} c={c} /> : <p class="muted">Your aspect, Human or Cyber, is chosen at Idunn's Well once the story offers it. Until then these points wait.</p>)}
      {tab === 'abilities' && <Abilities c={c} />}
      {tab === 'charms' && <Charms c={c} />}
    </Panel>
  );
}

function TreeView(props: { tree: TreeDef; which: 'cls' | 'human' | 'cyber'; c: CharacterState }) {
  const { tree, which, c } = props;
  const alloc = allocFor(c, which);
  const budget = budgetFor(c, which);
  const left = budget - spent(alloc);
  const rows = Math.max(...tree.nodes.map((n) => n.row)) + 1;
  const paths = tree.paths.length;
  return (
    <div>
      <p class="points">
        <strong>{left}</strong> point{left === 1 ? '' : 's'} to spend · {spent(alloc)} spent
        {which !== 'cls' && ` · ${which === 'human' ? 'Human' : 'Cyber'} aspect (${aspectPoints(c)} points, kept separately from the other aspect)`}
      </p>
      <div class="tree" style={{ gridTemplateColumns: `repeat(${paths}, 1fr)` }}>
        {tree.paths.map((name, pi) => (
          <div key={name} class="tree-col">
            <div class="tree-path">{name}</div>
            {Array.from({ length: rows }, (_, r) => {
              const nodes = tree.nodes.filter((n) => n.path === pi && n.row === r && (!n.cls || n.cls === c.cls));
              return (
                <div key={r} class="tree-row">
                  {nodes.map((n) => {
                    const rank = alloc[n.id] ?? 0;
                    const why = canRank(tree, alloc, n, budget, c.cls);
                    return (
                      <button
                        key={n.id}
                        class={'node' + (rank ? ' has' : '') + (rank === n.maxRank ? ' max' : '') + (n.row >= 5 ? ' cap' : '') + (n.ability ? ' abil' : '')}
                        aria-disabled={!!why}
                        title={why ?? ''}
                        onClick={() => run({ t: 'allocSkill', node: n.id, tree: which })}
                      >
                        <span class="nname">{n.name}</span>
                        <span class="nrank">
                          {rank}/{n.maxRank}
                        </span>
                        <span class="ndesc">{n.desc}</span>
                        {why && why !== 'Maxed' && <span class="nwhy">{why}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Abilities(props: { c: CharacterState }) {
  const db = api().db;
  const w = api().world()!;
  const bound = boundAbilities(w.players[0]!, db);
  const unlocked = unlockedAbilities(props.c, db);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div>
      <p class="muted">Pick an ability, then a slot. Keys 1-4, or LB plus a face button on a gamepad.</p>
      <div class="slots">
        {[0, 1, 2, 3].map((i) => (
          <button key={i} class={'slot' + (pick ? ' armed' : '')} onClick={() => pick !== null && run({ t: 'setAbility', idx: i, ability: pick }) && setPick(null)}>
            <small>{['1 · LB+X', '2 · LB+Y', '3 · LB+B', '4 · LB+A'][i]}</small>
            <strong>{bound[i] ? db.abilities[bound[i]!]?.name : '—'}</strong>
          </button>
        ))}
      </div>
      <div class="ability-list">
        {Object.values(db.abilities)
          .filter((a) => a.cls === props.c.cls || a.cls === props.c.alignment)
          .map((a) => {
            const ok = unlocked.includes(a.id);
            return (
              <button key={a.id} class={'ability' + (pick === a.id ? ' on' : '')} aria-disabled={!ok} onClick={() => ok && setPick(a.id)}>
                <strong>{a.name}</strong> <small>{(a.cd / 60).toFixed(0)} s</small>
                <span>{a.desc}</span>
                {!ok && <em>Unlocks from {treeNodeName(a.unlock)}</em>}
              </button>
            );
          })}
      </div>
    </div>
  );
}

function treeNodeName(id: string | null): string {
  if (!id) return '';
  const db = api().db;
  for (const t of [...Object.values(db.classes).map((c) => c.tree), db.alignTrees.human, db.alignTrees.cyber]) {
    const n = t.nodes.find((x) => x.id === id);
    if (n) return `${n.name} (${t.paths[n.path]})`;
  }
  return id;
}

function Charms(props: { c: CharacterState }) {
  const db = api().db;
  const equipped = props.c.equip.charm;
  return (
    <div>
      <p class="muted">
        Charms grant a Ruiner, spent with a full Ruin meter (R, or LB+RB). Equipped: <strong>{equipped ? db.bases[equipped.base]?.name : 'none — Ruin Pulse'}</strong>. Take charm quests at the quest board.
      </p>
      <div class="quests">
        {props.c.charms.map((q) => {
          const def = db.charms[q.id]!;
          return (
            <div key={q.id} class={'quest' + (q.done ? ' done' : '')}>
              <strong>{def.name}</strong> <small>{db.ruiners[def.ruiner]?.name}</small>
              {def.quests.map((s, i) => (
                <div key={i} class="qstep">
                  {s.text} <b>{Math.min(q.progress[i] ?? 0, s.count)}/{s.count}</b>
                </div>
              ))}
              {q.done && <em>Complete</em>}
            </div>
          );
        })}
        {!props.c.charms.length && <p class="muted">No charm quests taken yet.</p>}
      </div>
    </div>
  );
}
