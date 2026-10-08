import type { ContentDb } from '../core/data/types';
import type { GameRenderer } from '../render/scene';
import type { SoloSession } from './session';
import { generateItem } from '../core/loot/generate';
import { spawnPickup } from '../core/sim/pickups';
import type { PlayerInput } from '../core/input/frame';
import type { World } from '../core/sim/types';
import { panel, type Panel } from '../ui/store';

/** The debug autopilot's hooks into the loop. The bot itself is loaded only when asked for. */
export interface Autopilot {
  on: boolean;
  warp: number;
  input: ((w: World) => PlayerInput) | null;
  upkeep: ((w: World) => void) | null;
}

export interface DebugDeps {
  db: ContentDb;
  frames: () => number;
  session: () => SoloSession | null;
  newGame: (name: string, cls: string) => void;
  loop: { fps: number; simMs: number };
  gfx: GameRenderer;
  saveNow: () => Promise<void>;
  auto: Autopilot;
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
    /** Debug-only: visible meshes per top-level scene group, to see where draw calls go. */
    calls: () => {
      const out: Record<string, number> = {};
      const tops = d.gfx.scene.children.flatMap((t) => (t.name === 'entities' ? t.children : [t]));
      for (const top of tops) {
        let n = 0;
        top.traverseVisible((o) => {
          const m = o as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number; isPoints?: boolean };
          if ((m.isMesh && (!m.isInstancedMesh || (m.count ?? 0) > 0)) || m.isPoints) n++;
        });
        const k = top.name || top.type;
        out[k] = (out[k] ?? 0) + n;
      }
      return out;
    },
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
    /** Debug-only: let the balance bot play, `warp` ticks per frame; it tends its gear at waystones. */
    autopilot: async (on: boolean, aspect: 'human' | 'cyber' = 'human', warp = 1) => {
      const [{ botInput, newMemory }, { botUpkeep }] = await Promise.all([import('../core/bot/policies'), import('../core/bot/upkeep')]);
      const mem = newMemory();
      d.auto.input = (w) => {
        const inp = botInput(w, d.db, 0, 'tactical', mem, w.events);
        return inp;
      };
      d.auto.upkeep = (w) => botUpkeep(w, d.db, 0, aspect);
      d.auto.warp = Math.max(1, Math.min(16, warp));
      d.auto.on = on;
      const s = d.session();
      if (on && s) botUpkeep(s.world, d.db, 0, aspect);
    },
    /** Debug-only: open a menu panel by name (gate, smith, well, inventory...). */
    open: (name: string) => {
      panel.value = name as Panel;
    },
    /** Debug-only: the gate's travel, without the panel. */
    travel: (zone: string): string | null => {
      const s = d.session();
      if (!s) return 'no session';
      return s.command([{ t: 'travel', zone, node: '' }])[0] ?? null;
    },
    god: () => {
      const w = d.session()?.world;
      const e = w?.entities.find((x) => x.id === w.players[0]?.entity);
      if (e) e.hp = e.hpMax = 99999;
    },
  };
  (window as unknown as { __game: typeof hook }).__game = hook;
}
