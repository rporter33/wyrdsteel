import type { ContentDb } from '../data/types';
import type { InputFrame } from '../input/frame';
import type { World } from './types';
import { controlSystem } from './systems/control';
import { actionSystem } from './systems/actions';
import { motionSystem } from './systems/motion';
import { cleanupSystem } from './systems/cleanup';

/**
 * The only function that advances the world. Systems run in a fixed order; each reads the state
 * the previous one left. Given the same world, frame and content, the result is bit-identical.
 */
export function step(w: World, f: InputFrame, db: ContentDb): void {
  w.events = [];
  for (const e of w.entities) {
    e.px = e.x;
    e.pz = e.z;
    e.py = e.y;
  }
  controlSystem(w, f, db);
  actionSystem(w, db);
  motionSystem(w, db);
  cleanupSystem(w);
  for (const e of w.entities) if (e.hitstop > 0) e.hitstop--;
  w.tick++;
}
