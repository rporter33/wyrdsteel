import type { ContentDb } from '../core/data/types';
import type { GameRenderer } from '../render/scene';
import type { SoloSession } from './session';

export interface DebugDeps {
  db: ContentDb;
  frames: () => number;
  session: () => SoloSession | null;
  newGame: (name: string, cls: string) => void;
  loop: { fps: number; simMs: number };
  gfx: GameRenderer;
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
  };
  (window as unknown as { __game: typeof hook }).__game = hook;
}
