import type { ContentDb } from '../core/data/types';
import type { SimEvent, World } from '../core/sim/types';
import { toast } from '../ui/store';
import { itemName } from '../core/loot/gear';

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
        if (ev.slot !== local) break;
        if (ev.kind === 'shade') toast(`Your shade returns ${ev.amount} bounty.`, 'loot');
        else if (ev.kind === 'item') {
          const it = w.players[local]!.character.inv.find((x) => x.uid === ev.ref);
          if (it && it.rarity !== 'worn') toast(`${itemName(db, it)}`, 'loot', undefined, 2500);
        } else if (ev.kind === 'salvaged' && ev.rarity && ev.rarity !== 'worn') toast(`Auto-salvaged a ${ev.rarity} item (undo in Gear)`, 'info', undefined, 2500);
        else if (ev.kind === 'rune') toast(`Rune: ${db.runes[ev.ref]?.name ?? ev.ref}`, 'loot', undefined, 2500);
        else if (ev.kind === 'blueprint') toast(`Blueprint learned: ${db.blueprints[ev.ref]?.name ?? ev.ref}`, 'loot');
        break;
      case 'quest':
        if (ev.slot === local && ev.done) toast(`Charm quest complete: ${db.charms[ev.charm]?.name}. Skill point gained.`, 'loot', undefined, 5000);
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
