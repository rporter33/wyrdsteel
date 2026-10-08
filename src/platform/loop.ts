import { TICK_MS } from '../core/sim/constants';

export interface LoopHooks {
  /** Run one fixed simulation tick. */
  tick(): void;
  /** Draw, with alpha = how far between the last two ticks this frame falls. */
  render(alpha: number, dtMs: number): void;
  /** When true, ticks are not run (menus open in solo play). */
  paused(): boolean;
}

/** Fixed-step accumulator on requestAnimationFrame. Catch-up is capped so a stall never spirals. */
export function startLoop(h: LoopHooks, maxCatchUp = 5): { stop(): void; stats: { fps: number; simMs: number } } {
  let acc = 0;
  let last = performance.now();
  let running = true;
  const stats = { fps: 60, simMs: 0 };
  let fpsAcc = 0;
  let fpsN = 0;
  const frame = (now: number) => {
    if (!running) return;
    const dt = Math.min(250, now - last);
    last = now;
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 500) {
      stats.fps = (fpsN * 1000) / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    if (h.paused()) {
      acc = 0;
    } else {
      acc += dt;
      let n = 0;
      const t0 = performance.now();
      while (acc >= TICK_MS && n < maxCatchUp) {
        h.tick();
        acc -= TICK_MS;
        n++;
      }
      if (n === maxCatchUp) acc = 0;
      if (n > 0) stats.simMs = (performance.now() - t0) / n;
    }
    h.render(h.paused() ? 1 : acc / TICK_MS, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    stop: () => {
      running = false;
    },
    stats,
  };
}
