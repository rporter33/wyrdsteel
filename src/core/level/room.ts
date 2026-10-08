import type { ContentDb, RoomDef } from '../data/types';
import { parseAscii, type Grid, type Marker } from './grid';

export interface BuiltRoom {
  def: RoomDef;
  grid: Grid;
  markers: Marker[];
}

export function buildRoom(db: ContentDb, roomId: string, variant: number): BuiltRoom {
  const def = db.rooms[roomId];
  if (!def) throw new Error(`unknown room ${roomId}`);
  const rows = def.variants[variant % def.variants.length]!;
  const { grid, markers } = parseAscii(rows);
  return { def, grid, markers };
}

export function markersOf(r: BuiltRoom, c: string): Marker[] {
  return r.markers.filter((m) => m.c === c);
}
