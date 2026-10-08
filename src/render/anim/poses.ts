import type { Rig } from '../models/humanoid';

export interface PoseState {
  /** Ground speed in m/s and an accumulating walk phase (radians). */
  speed: number;
  phase: number;
  /** Pose family of the current action, and progress 0..1 through it; strike = progress of first hit. */
  pose: string | null;
  t: number;
  strike: number;
  airborne: boolean;
  stun: number;
  dead: boolean;
  aiming: boolean;
  hurt: number;
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Rigid-part animation: every limb is a pivot rotated by a small formula of the action progress.
 * No skeletons, no clips; an action's pose family plus its hit timing is enough to read clearly.
 */
export function applyPose(r: Rig, s: PoseState): void {
  const { hips, torso, armL, armR, foreL, foreR, legL, legR, head } = r;
  // Reset.
  for (const g of [hips, torso, armL, armR, foreL, foreR, legL, legR, head]) g.rotation.set(0, 0, 0);
  hips.position.y = 0.95 * r.scale;
  r.root.rotation.set(0, r.root.rotation.y, 0);

  if (s.dead) {
    r.root.rotation.x = -Math.PI / 2 * 0.95;
    hips.position.y = 0.25;
    return;
  }

  // Locomotion.
  const stride = Math.min(1, s.speed / 6);
  const sw = Math.sin(s.phase) * 0.7 * stride;
  legL.rotation.x = sw;
  legR.rotation.x = -sw;
  armL.rotation.x = -sw * 0.6;
  armR.rotation.x = sw * 0.6;
  hips.position.y += Math.abs(Math.cos(s.phase)) * 0.05 * stride;
  torso.rotation.x = 0.12 * stride;

  if (s.aiming && !s.pose) {
    armR.rotation.x = -1.45;
    armL.rotation.x = -1.2;
    armL.rotation.z = -0.3;
    torso.rotation.y = 0.15;
  }

  if (s.airborne && !s.pose) {
    legL.rotation.x = -0.6;
    legR.rotation.x = 0.3;
    armL.rotation.z = -0.6;
    armR.rotation.z = 0.6;
  }

  if (s.stun > 0) {
    torso.rotation.x = -0.4;
    head.rotation.x = -0.3;
    armL.rotation.z = -0.8;
    armR.rotation.z = 0.8;
  }

  if (!s.pose) return;
  // Wind-up runs until the strike, follow-through after it.
  const st = Math.max(0.05, s.strike);
  const wind = ease(s.t / st);
  const follow = ease((s.t - st) / Math.max(0.05, 1 - st));
  const pre = s.t < st;
  switch (s.pose) {
    case 'roll': {
      const a = s.t * Math.PI * 2;
      hips.rotation.x = a;
      hips.position.y = 0.55 + Math.sin(s.t * Math.PI) * 0.1;
      legL.rotation.x = -1.4;
      legR.rotation.x = -1.4;
      armL.rotation.x = -1.2;
      armR.rotation.x = -1.2;
      break;
    }
    case 'slashR':
      torso.rotation.y = pre ? wind * 0.9 : 0.9 - follow * 1.8;
      armR.rotation.x = -1.4;
      armR.rotation.z = pre ? 0.9 * wind : 0.9 - 1.7 * follow;
      armL.rotation.x = -0.6;
      break;
    case 'slashL':
      torso.rotation.y = pre ? -wind * 0.9 : -0.9 + follow * 1.8;
      armL.rotation.x = -1.4;
      armL.rotation.z = pre ? -0.9 * wind : -0.9 + 1.7 * follow;
      armR.rotation.x = -0.6;
      break;
    case 'twin':
      torso.rotation.y = Math.sin(s.t * Math.PI * 2) * 0.6;
      armL.rotation.x = -1.5;
      armR.rotation.x = -1.5;
      armL.rotation.z = -0.8 + follow * 1.2;
      armR.rotation.z = 0.8 - follow * 1.2;
      break;
    case 'thrust':
      armR.rotation.x = pre ? -0.4 - wind * 0.4 : -1.6;
      foreR.rotation.x = pre ? -1.2 * wind : 0;
      torso.rotation.y = pre ? 0.4 * wind : -0.2;
      legL.rotation.x = -0.5;
      legR.rotation.x = 0.4;
      break;
    case 'overhead':
      armR.rotation.x = pre ? -2.9 * wind : -2.9 + 2.5 * follow;
      armL.rotation.x = pre ? -2.9 * wind : -2.9 + 2.5 * follow;
      torso.rotation.x = pre ? -0.3 * wind : 0.5 * follow;
      break;
    case 'uppercut':
      armR.rotation.x = pre ? 0.6 * wind : 0.6 - 3.4 * follow;
      torso.rotation.x = pre ? 0.4 * wind : 0.4 - 0.8 * follow;
      legL.rotation.x = -0.4;
      break;
    case 'spin':
      r.root.rotation.y += s.t * Math.PI * 4;
      armL.rotation.z = -1.4;
      armR.rotation.z = 1.4;
      break;
    case 'slam':
      armR.rotation.x = -2.9 + 2.6 * ease(s.t * 1.5);
      armL.rotation.x = -2.9 + 2.6 * ease(s.t * 1.5);
      legL.rotation.x = -0.9;
      legR.rotation.x = -0.9;
      torso.rotation.x = 0.6 * ease(s.t * 1.5);
      break;
    case 'shoot':
      armR.rotation.x = -1.55;
      armL.rotation.x = -1.3;
      armL.rotation.z = -0.35;
      torso.rotation.x = s.t < 0.3 ? -0.12 : 0;
      break;
    case 'heave':
      armR.rotation.x = pre ? -2.6 * wind : -2.6 + 3 * follow;
      armL.rotation.x = pre ? -2.6 * wind : -2.6 + 3 * follow;
      torso.rotation.x = pre ? -0.4 * wind : 0.4;
      break;
    case 'cast':
      armL.rotation.x = -1.9 + Math.sin(s.t * 10) * 0.1;
      armR.rotation.x = -1.9 - Math.sin(s.t * 10) * 0.1;
      armL.rotation.z = -0.4;
      armR.rotation.z = 0.4;
      head.rotation.x = -0.2;
      break;
    case 'leap':
      legL.rotation.x = -1.0;
      legR.rotation.x = 0.6;
      armR.rotation.x = -2.8 + 2.4 * follow;
      armL.rotation.x = -2.8 + 2.4 * follow;
      break;
    case 'howl':
      torso.rotation.x = -0.4;
      head.rotation.x = -0.5;
      armL.rotation.z = -1.2;
      armR.rotation.z = 1.2;
      break;
    case 'throw':
      armR.rotation.x = pre ? -2.6 * wind : -2.6 + 3.2 * follow;
      torso.rotation.y = pre ? 0.6 * wind : -0.4;
      break;
    case 'block':
      armL.rotation.x = -1.4;
      armL.rotation.y = 0.6;
      break;
  }
  if (s.hurt > 0) torso.rotation.x -= s.hurt * 0.25;
}
