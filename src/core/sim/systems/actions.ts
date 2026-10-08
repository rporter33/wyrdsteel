import { TICK_HZ } from '../constants';
import type { ContentDb, ActionDef } from '../../data/types';
import type { Entity, World } from '../types';
import { byId } from '../entity';
import { BTN } from '../../input/frame';

export function startAction(w: World, e: Entity, def: ActionDef, dx: number, dz: number, target = 0, node = ''): void {
  const tg = target ? byId(w, target) : null;
  e.act = { id: def.id, t: 0, ax: tg ? tg.x : e.x + dx * 3, az: tg ? tg.z : e.z + dz * 3, hit: [], node, dx, dz, target, moved: 0 };
  e.fx = dx;
  e.fz = dz;
}

/**
 * Advance every running action one tick: timers, i-frames, armor, scripted movement (lunge,
 * dash, launcher jump). Hits, shots and spawns are resolved by their own systems reading `act.t`.
 */
export function actionSystem(w: World, db: ContentDb): void {
  for (const e of w.entities) {
    if (e.dead || !e.act || e.hitstop > 0) continue;
    if (e.stun > 0 || e.status.freeze > 0) {
      e.act = null;
      continue;
    }
    const def = db.actions[e.act.id]!;
    const a = e.act;
    a.t++;
    e.iframes = def.iframes && a.t >= def.iframes[0] && a.t < def.iframes[1] ? 1 : e.iframes > 1 ? e.iframes : 0;
    e.armorT = def.armor && a.t >= def.armor[0] && a.t < def.armor[1] ? 1 : 0;
    if (def.jump && a.t === Math.max(1, def.jump.at)) {
      // Launcher follow-up: rise with the target only while the button is still held.
      const held = !def.jump.ifHeld || (e.pl && (w.players[e.pl.slot]!.lastInput.held & BTN.launcher) !== 0);
      if (held) e.vy = Math.max(e.vy, def.jump.vy);
    }
    const lunge = def.lunge;
    if (lunge && a.t >= lunge.from && a.t < lunge.to) {
      let dist = lunge.dist;
      const tgt = a.target ? byId(w, a.target) : null;
      if (tgt && !tgt.dead) {
        // Stop at contact range: assist closes the gap but never pushes through the target.
        const gap = Math.sqrt((tgt.x - e.x) * (tgt.x - e.x) + (tgt.z - e.z) * (tgt.z - e.z)) - (tgt.r + e.r + 0.25);
        dist = Math.max(0, Math.min(dist, gap + a.moved));
      }
      const per = dist / (lunge.to - lunge.from);
      const remaining = Math.max(0, dist - a.moved);
      const step = Math.min(per, remaining);
      a.moved += step;
      e.vx = a.dx * step * TICK_HZ;
      e.vz = a.dz * step * TICK_HZ;
    } else if (def.dash && a.t >= def.dash.from && a.t < def.dash.to) {
      const per = def.dash.dist / (def.dash.to - def.dash.from);
      e.vx = a.dx * per * TICK_HZ;
      e.vz = a.dz * per * TICK_HZ;
    } else if (e.kind !== 'player' || def.move === 0) {
      // Rooted portion of an action bleeds off momentum quickly.
      e.vx *= 0.6;
      e.vz *= 0.6;
    }
    if (def.slam && e.y > 0 && a.t >= (def.hits[0]?.from ?? 0)) e.vy = Math.min(e.vy, -26);
    if (a.t >= def.len) {
      e.act = null;
      e.iframes = 0;
      e.armorT = 0;
    }
  }
}

export function canCancel(e: Entity, db: ContentDb): boolean {
  if (!e.act) return true;
  const def = db.actions[e.act.id]!;
  return e.act.t >= def.cancel;
}
