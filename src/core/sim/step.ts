import type { ContentDb } from '../data/types';
import type { InputFrame } from '../input/frame';
import type { World } from './types';
import { controlSystem } from './systems/control';
import { actionSystem } from './systems/actions';
import { motionSystem } from './systems/motion';
import { cleanupSystem } from './systems/cleanup';
import { vitalsSystem } from './systems/vitals';
import { deathSystem } from './systems/deaths';
import { hitSystem } from '../combat/hits';
import { projectileSystem } from '../combat/projectiles';
import { statusSystem } from '../combat/status';
import { emitSystem } from '../combat/emit';
import { aiSystem } from '../ai/system';
import { encounterSystem } from '../level/encounters';
import { playerSystem } from './systems/players';
import { onEnemyDeath } from '../progression/drops';
import { travel, playStory } from '../level/travel';
import { roomSystem } from '../level/hazards';
import { turretSystem } from '../combat/turret';

/**
 * The only function that advances the world. Systems run in a fixed order; each reads the state
 * the previous one left. Given the same world, frame and content, the result is bit-identical.
 */
export function step(w: World, f: InputFrame, db: ContentDb): void {
  w.events = [];
  // The very first tick of a run plays the starting room's story beat (once per character).
  if (w.tick === 0) {
    const node = db.zones[w.zone.id]?.nodes.find((n) => n.id === w.zone.node);
    if (node?.story) playStory(w, node.story);
  }
  for (const e of w.entities) {
    e.px = e.x;
    e.pz = e.z;
    e.py = e.y;
  }
  controlSystem(w, f, db);
  aiSystem(w, db);
  actionSystem(w, db);
  emitSystem(w, db);
  motionSystem(w, db);
  hitSystem(w, db);
  turretSystem(w, db);
  projectileSystem(w, db);
  statusSystem(w);
  vitalsSystem(w, db);
  deathSystem(w, db, [onEnemyDeath]);
  playerSystem(w, db);
  encounterSystem(w, db);
  roomSystem(w, db);
  cleanupSystem(w);
  for (const e of w.entities) if (e.hitstop > 0) e.hitstop--;
  w.tick++;
  // Room changes happen between ticks, inside the sim, so they replay identically.
  if (w.transition && w.transition.at <= w.tick) {
    const { to, zone } = w.transition;
    w.transition = null;
    travel(w, db, to, zone);
  }
}
