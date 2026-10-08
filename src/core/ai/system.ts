import type { ContentDb } from '../data/types';
import type { World } from '../sim/types';
import { pickTarget, fighter, frostwright, mender, burrower, eliteHooks } from './brains';
import { hrungnir, guardian } from './boss';
import { releaseToken } from './director';
import { stop } from './steer';
import { dist } from './steer';

/** Think for every enemy, in id order. Stunned, frozen or airborne enemies lose their token. */
export function aiSystem(w: World, db: ContentDb): void {
  for (const e of w.entities) {
    if (e.kind !== 'enemy' || !e.ai) continue;
    const ai = e.ai;
    if (e.dead) {
      releaseToken(e);
      continue;
    }
    const def = db.enemies[e.def]!;
    if (def.brain === 'dummy' || ai.st === 'static') continue;
    for (let i = 0; i < ai.cds.length; i++) if (ai.cds[i]! > 0) ai.cds[i]!--;
    if (ai.gcd > 0) ai.gcd--;
    if (e.hitstop > 0) continue;
    if (e.stun > 0 || e.status.freeze > 0 || e.y > 0.05) {
      releaseToken(e);
      if (ai.st === 'attack') ai.st = 'recover';
      if (e.y <= 0.05) stop(e);
      continue;
    }
    eliteHooks(w, db, e);
    const t = pickTarget(w, e, def.aggro);
    if (!t) {
      releaseToken(e);
      // Drift home when nobody is around.
      stop(e);
      continue;
    }
    if (!ai.aggro) {
      ai.aggro = true;
      // Alert the rest of the encounter.
      for (const o of w.entities) if (o.ai && o.ai.enc === ai.enc && ai.enc >= 0 && dist(o, e) < 14) o.ai.aggro = true;
    }
    ai.target = t.id;
    switch (def.brain) {
      case 'frostwright':
        frostwright(w, db, e, def, t);
        break;
      case 'mender':
        mender(w, db, e, def, t);
        break;
      case 'burrower':
        burrower(w, db, e, def, t);
        break;
      case 'hrungnir':
        hrungnir(w, db, e, def, t);
        break;
      case 'guardian':
        guardian(w, db, e, def, t);
        break;
      default:
        fighter(w, db, e, def, t);
    }
  }
}
