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
        // Edges are solid (doors aside) so nothing walks out of the world.
        const door = (x: number, z: number) => markersOf(r, 'D').some((m) => Math.floor(m.x) === x && Math.floor(m.z) === z);
        for (let x = 0; x < r.grid.w; x++) {
          for (const z of [0, r.grid.h - 1]) expect(blocksMove(r.grid.tiles[z * r.grid.w + x]!) || door(x, z), `${room.id}#${v} edge ${x},${z}`).toBe(true);
        }
        for (let z = 0; z < r.grid.h; z++) {
          for (const x of [0, r.grid.w - 1]) expect(blocksMove(r.grid.tiles[z * r.grid.w + x]!) || door(x, z), `${room.id}#${v} edge ${x},${z}`).toBe(true);
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
        for (const nx of n.next) {
          const [zz, nn] = nx.includes(':') ? nx.split(':') : [z.id, nx];
          expect(d.zones[zz!]?.nodes.some((m) => m.id === nn), `${z.id}/${n.id} -> ${nx}`).toBe(true);
        }
        if (n.story) expect(d.story[n.story], n.story).toBeDefined();
        if (n.onClear?.story) expect(d.story[n.onClear.story], n.onClear.story).toBeDefined();
        const r = buildRoom(d, n.room, 0);
        expect(markersOf(r, 'D').length, `${n.room} exits for ${n.id}`).toBeGreaterThanOrEqual(n.next.length);
      }
    }
  });
});
