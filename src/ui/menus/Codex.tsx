import { api } from '../api';
import { Panel } from './common';
import type { CharacterState } from '../../core/progression/character';

export function unlocked(c: CharacterState, unlock: string): boolean {
  if (unlock.startsWith('kill:')) return (c.kills[unlock.slice(5)] ?? 0) > 0;
  if (unlock.startsWith('beat:')) return !!c.story[unlock];
  return !!c.story[unlock];
}

/** Bragi's codex: what the Sworn has learned, about places and the things in them. */
export function Codex() {
  const db = api().db;
  const c = api().world()!.players[0]!.character;
  const open = db.codex.filter((e) => unlocked(c, e.unlock));
  return (
    <Panel title="Bragi's codex" wide>
      <p class="lore">"Every song is a warning someone survived. Here are yours so far."</p>
      <div class="codex">
        {open.map((e) => (
          <article key={e.id}>
            <h4>{e.title}</h4>
            <p>{e.text}</p>
          </article>
        ))}
      </div>
      <p class="muted">
        {open.length} of {db.codex.length} entries. More open as you fight new foes and reach new places.
      </p>
    </Panel>
  );
}
