import { msToTicks } from '../constants';
import { BTN, emptyInput, type InputFrame, type PlayerInput, AIM_UNIT } from '../../input/frame';
import { norm, rotateToward } from '../../math/vec';
import type { ContentDb } from '../../data/types';
import type { Entity, PlayerSlot, World } from '../types';
import { byId } from '../entity';
import { startAction, canCancel } from './actions';
import { attackControl } from '../../combat/attack';

const DODGE_RECHARGE = msToTicks(1100);
// ~70 degrees a tick: turning feels instant, but a reversal still reads as a turn, not a flip.
const TURN_RATE = 1.2;
const ACCEL = 0.32;

export function aimVector(e: Entity, inp: PlayerInput): [number, number] | null {
  if (inp.ax === 0 && inp.az === 0) return null;
  return norm(inp.ax * AIM_UNIT, inp.az * AIM_UNIT, e.fx, e.fz);
}

export function controlSystem(w: World, f: InputFrame, db: ContentDb): void {
  for (const p of w.players) {
    const e = byId(w, p.entity);
    const inp = f.inputs[p.slot] ?? emptyInput();
    p.lastInput = inp;
    if (!e) continue;
    controlPlayer(w, db, p, e, inp);
  }
}

function controlPlayer(w: World, db: ContentDb, p: PlayerSlot, e: Entity, inp: PlayerInput): void {
  const pl = e.pl!;
  if (pl.dodges < p.stats.dodgeCharges && w.tick - pl.dodgeAt >= DODGE_RECHARGE) {
    pl.dodges++;
    pl.dodgeAt = w.tick;
  }
  if (e.dead) return;
  const [mx, mz] = [inp.mx / 127, inp.mz / 127];
  const moving = mx * mx + mz * mz > 0.01;
  const aim = aimVector(e, inp);

  // Buffer combat presses so a press just before the cancel window is not lost (133 ms).
  if (inp.pressed & BTN.light) pl.buffer = { input: 'light', at: w.tick };
  else if (inp.pressed & BTN.heavy) pl.buffer = { input: 'heavy', at: w.tick };
  else if (inp.pressed & BTN.launcher) pl.buffer = { input: 'launcher', at: w.tick };
  if (pl.buffer && w.tick - pl.buffer.at > msToTicks(133)) pl.buffer = null;

  if (e.hitstop > 0) return;
  if (e.stun > 0 || e.status.freeze > 0) {
    e.vx *= 0.8;
    e.vz *= 0.8;
    return;
  }

  // Dodge: cancels almost anything after its cancel point; two charges. The Well of Standing forbids it.
  if (inp.pressed & BTN.dodge && w.room.rule === 'nododge') w.events.push({ k: 'immune', t: w.tick, dst: e.id });
  else if (inp.pressed & BTN.dodge && pl.dodges > 0 && (canCancel(e, db) || (e.act && e.act.t > 4 && !db.actions[e.act.id]!.armor))) {
    const cls = db.classes[p.character.cls]!;
    const dodge = db.actions[cls.dodge]!;
    const [dx, dz] = moving ? norm(mx, mz) : [-e.fx, -e.fz];
    startAction(w, e, dodge, dx, dz);
    if (pl.dodges === p.stats.dodgeCharges) pl.dodgeAt = w.tick;
    pl.dodges--;
    pl.lastDodge = w.tick;
    pl.obsDodge++;
    pl.buffer = null;
    w.events.push({ k: 'dodge', t: w.tick, src: e.id, perfect: false });
    // Face the dodge but keep the aim facing restored after.
    e.fx = dx;
    e.fz = dz;
    return;
  }

  attackControl(w, db, p, e, inp, aim, moving ? [mx, mz] : null);

  // Locomotion: full control when idle, partial during actions that allow movement.
  const def = e.act ? db.actions[e.act.id]! : null;
  const moveMult = def ? def.move : 1;
  const rooted = e.status.root > 0;
  const chill = e.status.chill > 0 ? 0.6 : 1;
  const precise = inp.held & BTN.precise ? 0.6 : 1;
  const firing = inp.held & BTN.fire ? (db.weapons[p.stats.rangedKind]?.fire?.moveMult ?? 0.8) : 1;
  const speed = rooted ? 0 : p.stats.speed * chill * precise * firing * moveMult;
  if (!def || (!def.lunge && !def.dash) || moveMult > 0) {
    const tvx = mx * speed;
    const tvz = mz * speed;
    if (!def || moveMult > 0) {
      e.vx += (tvx - e.vx) * ACCEL;
      e.vz += (tvz - e.vz) * ACCEL;
    }
  }

  // Facing: aim wins, then movement. Locked actions keep their committed direction.
  if (!def || def.turn > 0) {
    const want = aim ?? (moving ? norm(mx, mz) : null);
    if (want) {
      const step = def ? def.turn : TURN_RATE;
      [e.fx, e.fz] = rotateToward(e.fx, e.fz, want[0], want[1], step);
    }
  }
}
