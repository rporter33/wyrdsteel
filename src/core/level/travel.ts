import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import { enterNode } from '../sim/world';
import { msToTicks } from '../sim/constants';

/** "zone:node" leaves the zone; a bare node stays in it. */
export function parseTarget(w: World, to: string): { zone: string; node: string } {
  const i = to.indexOf(':');
  return i < 0 ? { zone: w.zone.id, node: to } : { zone: to.slice(0, i), node: to.slice(i + 1) };
}

/**
 * Move the party to a node. Changing zone starts that zone's run fresh: nothing cleared, the
 * entrance as the waystone. Within a zone, cleared rooms stay cleared.
 */
export function travel(w: World, db: ContentDb, to: string, zoneOverride?: string, trial?: { trial: number; mods: string[] }): void {
  const t = parseTarget(w, to);
  const zone = zoneOverride ?? t.zone;
  if (zone !== w.zone.id || trial) {
    w.zone = { id: zone, cleared: [], node: t.node, waystone: t.node, sinceWaystone: 0, shade: null, mods: trial ? [...trial.mods] : [], trial: trial?.trial ?? 0 };
  }
  enterNode(w, db, t.node, 'exit');
  // First visit to a room with a story beat: play it once per character.
  const node = db.zones[w.zone.id]?.nodes.find((n) => n.id === w.zone.node);
  if (node?.story) playStory(w, node.story);
}

export function playStory(w: World, beat: string): void {
  const c = w.players[0]?.character;
  if (!c || c.story[`beat:${beat}`]) return;
  for (const p of w.players) p.character.story[`beat:${beat}`] = 1;
  w.events.push({ k: 'story', t: w.tick, beat });
}

/** Room-clear consequences from the zone graph: flags, a story beat, a sigil, a send-off. */
export function onRoomCleared(w: World, db: ContentDb): void {
  const node = db.zones[w.zone.id]?.nodes.find((n) => n.id === w.zone.node);
  const oc = node?.onClear;
  if (!oc) return;
  // A trial is done when its zone sends the party home: the tier is recorded and the next opens.
  if (w.zone.trial && oc.to && parseTarget(w, oc.to).zone !== w.zone.id) {
    for (const p of w.players) {
      const key = `trial:${w.zone.id}`;
      p.character.story[key] = Math.max(p.character.story[key] ?? 0, w.zone.trial);
    }
    w.events.push({ k: 'trial', t: w.tick, zone: w.zone.id, tier: w.zone.trial });
    w.transition = { to: oc.to, at: w.tick + Math.max(1, msToTicks(oc.delayMs ?? 0)) };
    return;
  }
  for (const p of w.players) {
    for (const [k, v] of Object.entries(oc.flags ?? {})) p.character.story[k] = v;
    if (oc.sigil && !p.character.story[`sigil:${w.zone.id}:${node!.id}`]) {
      p.character.story[`sigil:${w.zone.id}:${node!.id}`] = 1;
      p.character.sigils++;
    }
  }
  if (oc.story) playStory(w, oc.story);
  if (oc.to) w.transition = { to: oc.to, at: w.tick + Math.max(1, msToTicks(oc.delayMs ?? 0)) };
}
