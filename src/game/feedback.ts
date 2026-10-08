import type { ContentDb } from '../core/data/types';
import type { SimEvent, World } from '../core/sim/types';
import { toast } from '../ui/store';

/** Turns notable sim events into short messages for the local player. */
export function eventToasts(w: World, db: ContentDb, events: SimEvent[], local: number): void {
  for (const ev of events) {
    switch (ev.k) {
      case 'levelUp':
        if (ev.slot === local) toast(`Level ${ev.level}. Skill point gained.`, 'loot');
        break;
      case 'waystone':
        if (ev.slot === local) toast('Waystone attuned: health and flasks restored.');
        break;
      case 'encounter':
        if (ev.state === 'done' && w.room.cleared) toast('The way opens.');
        break;
      case 'pickup':
        if (ev.slot === local && ev.kind === 'shade') toast(`Your shade returns ${ev.amount} bounty.`, 'loot');
        break;
      case 'playerDown':
        if (ev.slot === local && w.zone.shade) toast(`The Valkyrie's toll: ${w.zone.shade.amount} bounty left where you fell.`, 'error', undefined, 5000);
        break;
      case 'exit': {
        const zone = db.zones[w.zone.id];
        const node = zone?.nodes.find((n) => n.id === ev.to);
        const room = node ? db.rooms[node.room] : null;
        if (room) toast(room.name);
        break;
      }
    }
  }
}
