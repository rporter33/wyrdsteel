import type { ContentDb } from '../core/data/types';
import type { GameRenderer } from '../render/scene';
import type { SoloSession } from './session';
import { generateItem } from '../core/loot/generate';
import { spawnPickup } from '../core/sim/pickups';

export interface DebugDeps {
  db: ContentDb;
  frames: () => number;
  session: () => SoloSession | null;
  newGame: (name: string, cls: string) => void;
  loop: { fps: number; simMs: number };
  gfx: GameRenderer;
  saveNow: () => Promise<void>;
}

/**
 * window.__game, only with ?debug=1. The browser tests drive and assert through this rather than
 * reading pixels, which keeps them stable under software rendering.
 */
export function installDebug(d: DebugDeps): void {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const hook = {
    get frames() {
      return d.frames();
    },
    get tick() {
      return d.session()?.world.tick ?? -1;
    },
    world: () => d.session()?.world ?? null,
    player: () => {
      const w = d.session()?.world;
      return w?.entities.find((e) => e.id === w.players[0]?.entity) ?? null;
    },
    newGame: d.newGame,
    perf: () => ({ ...d.loop, ...d.gfx.info() }),
    replay: () => d.session()?.recorder.build() ?? null,
    /** Debug-only travel: queues a room change the sim applies at the end of the next tick. */
    goto: (node: string) => {
      const w = d.session()?.world;
      if (w) w.transition = { to: node, at: w.tick };
    },
    /** Debug-only: drop a generated item at the player's feet. */
    drop: (rarity: string) => {
      const w = d.session()?.world;
      const e = w?.entities.find((x) => x.id === w.players[0]?.entity);
      if (!w || !e) return;
      const item = generateItem(w.tick * 7919 + 13, { ilvl: Math.max(2, e.level + 2), cls: w.players[0]!.character.cls, weights: [1, 1, 1, 1, 1], rarity: rarity as never, base: w.players[0]!.character.cls === 'berserker' ? 'w.blades.2' : 'w.rifle.2' }, d.db);
      const p = spawnPickup(w, 'item', e.x, e.z, 1, item.uid, 0);
      p.pick!.item = item;
      p.vx = p.vz = p.vy = 0;
      p.y = 0;
    },
    save: () => d.saveNow(),
    god: () => {
      const w = d.session()?.world;
      const e = w?.entities.find((x) => x.id === w.players[0]?.entity);
      if (e) e.hp = e.hpMax = 99999;
    },
  };
  (window as unknown as { __game: typeof hook }).__game = hook;
}
