import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { buildRoom, markersOf } from '../../../src/core/level/room';
import { reachable, blocksMove } from '../../../src/core/level/grid';

describe('content packs', () => {
  const d = db();
  it('enemy references resolve', () => {
    for (const e of Object.values(d.enemies)) {
      for (const a of e.attacks) {
        const act = d.actions[a.action];
        expect(act, `${e.id} -> ${a.action}`).toBeDefined();
        if (act?.shoot) expect(d.projectiles[act.shoot.proj], act.shoot.proj).toBeDefined();
        expect(a.min).toBeLessThanOrEqual(a.max);
      }
      for (const p of e.parts) expect(['kneel', 'noThrow', 'expose']).toContain(p.effect);
    }
  });

  for (const room of Object.values(d.rooms)) {
    it(`room ${room.id}: every variant is closed and its markers are reachable from the entrance`, () => {
      room.variants.forEach((_, v) => {
        const r = buildRoom(d, room.id, v);
        const start = markersOf(r, 'P')[0];
        expect(start, `${room.id}#${v} has no entrance`).toBeDefined();
        const seen = reachable(r.grid, start!.x, start!.z);
        for (const m of r.markers) {
          const i = Math.floor(m.z) * r.grid.w + Math.floor(m.x);
          if (blocksMove(r.grid.tiles[i]!)) continue;
          expect(seen[i], `${room.id}#${v} marker '${m.c}' at ${m.x},${m.z} unreachable`).toBe(true);
        }
        // Edges are solid so nothing walks out of the world.
        for (let x = 0; x < r.grid.w; x++) {
          expect(blocksMove(r.grid.tiles[x]!) || markersOf(r, 'D').some((m) => Math.floor(m.x) === x && Math.floor(m.z) === 0)).toBe(true);
        }
        for (const [k, enc] of Object.entries(room.encounters)) {
          expect(markersOf(r, k).length, `${room.id} encounter ${k} has no marker`).toBeGreaterThan(0);
          for (const wave of enc.waves) for (const id of wave) expect(d.enemies[id], id).toBeDefined();
          for (const el of enc.elite ?? []) expect(d.elites[el], el).toBeDefined();
        }
      });
    });
  }

  it('zone nodes point at real rooms and exits match their links', () => {
    for (const z of Object.values(d.zones)) {
      for (const n of z.nodes) {
        expect(d.rooms[n.room], `${z.id}/${n.id}`).toBeDefined();
        for (const nx of n.next) expect(z.nodes.some((m) => m.id === nx), `${z.id}/${n.id} -> ${nx}`).toBe(true);
        const r = buildRoom(d, n.room, 0);
        expect(markersOf(r, 'D').length, `${n.room} exits for ${n.id}`).toBeGreaterThanOrEqual(n.next.length);
      }
    }
  });
});
