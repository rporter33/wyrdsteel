import * as THREE from 'three';
import type { World } from '../../core/sim/types';
import { box, cyl, glow, cone, ico, bakeStatic, bakeable } from '../models/kit';
import { PALETTE, toon } from '../materials';
import { buildNpc } from '../models/npcs';
import { applyPose } from '../anim/poses';
import type { Rig } from '../models/humanoid';

interface FView {
  obj: THREE.Object3D;
  kind: string;
  i: number;
  rig?: Rig;
  glow?: THREE.Mesh;
  barrier?: THREE.Mesh;
  /** A chest's lid, which opens. */
  lid?: THREE.Object3D;
  phase: number;
}

/** Room furniture that the sim tracks as features: waystones, exits, NPCs, braziers, vents. */
export class FeatureViews {
  readonly group = new THREE.Group();
  private items: FView[] = [];
  private exits: FView[] = [];
  private tethers: THREE.LineSegments;
  private t = 0;

  constructor() {
    this.tethers = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fe0a0, transparent: true, opacity: 0.8 }));
    this.tethers.frustumCulled = false;
  }

  build(w: World): void {
    this.group.clear();
    this.items = [];
    this.exits = [];
    this.group.add(this.tethers);
    w.room.features.forEach((f, i) => {
      const g = new THREE.Group();
      g.position.set(f.x, 0, f.z);
      const v: FView = { obj: g, kind: f.kind, i, phase: i };
      switch (f.kind) {
        case 'waystone': {
          const base = cyl(0.7, 0.9, 0.3, 0x3a434d, 8, 0.15);
          const stone = box(0.55, 2.1, 0.35, 0x59636e, 1.3);
          stone.rotation.y = 0.3;
          const rune = glow(0.09, PALETTE.rune, 2.5);
          rune.scale.set(1, 4, 1);
          rune.position.set(0, 1.4, 0.2);
          rune.rotation.y = 0.3;
          v.glow = rune;
          g.add(base, stone, rune);
          break;
        }
        case 'npc': {
          // Posed once, then baked: NPCs stand still, so they cost two draw calls each.
          const r = buildNpc(f.id);
          applyPose(r, { speed: 0, phase: 0, pose: null, t: 0, strike: 0, airborne: false, stun: 0, dead: false, aiming: false, hurt: 0 });
          const baked = bakeStatic(r.root);
          baked.rotation.y = Math.PI;
          g.add(baked);
          break;
        }
        case 'brazier': {
          g.add(cyl(0.35, 0.25, 0.9, PALETTE.iron, 7, 0.45));
          const fire = glow(0.28, PALETTE.ember, 2.2);
          fire.position.y = 1.05;
          fire.scale.y = 1.4;
          v.glow = fire;
          g.add(fire);
          break;
        }
        case 'vent': {
          const grate = box(1.6, 0.06, 1.6, 0x2a2420, 0.03);
          const heat = glow(0.5, PALETTE.ember, 1.5);
          heat.scale.set(1.4, 0.05, 1.4);
          heat.position.y = 0.06;
          v.glow = heat;
          g.add(grate, heat);
          break;
        }
        case 'geyser': {
          const ring = cyl(0.8, 0.9, 0.2, 0x4c6577, 10, 0.1);
          const water = glow(0.55, PALETTE.frost, 1.2);
          water.scale.set(1.3, 0.1, 1.3);
          water.position.y = 0.2;
          v.glow = water;
          g.add(ring, water);
          break;
        }
        case 'generator': {
          g.add(cyl(0.5, 0.6, 1.4, PALETTE.iron, 8, 0.7));
          const core = glow(0.3, PALETTE.gold, 2.5);
          core.position.y = 1.6;
          v.glow = core;
          g.add(core);
          break;
        }
        case 'chest': {
          v.lid = box(1.04, 0.14, 0.64, PALETTE.gold, 0.62);
          g.add(box(1.0, 0.6, 0.6, PALETTE.wood, 0.3), v.lid);
          break;
        }
        case 'shrine': {
          g.add(cyl(0.9, 1.1, 0.25, 0x2a3644, 9, 0.12));
          const orb = glow(0.35, 0xc07bff, 2.4);
          orb.position.y = 1.4;
          v.glow = orb;
          g.add(orb, cone(0.2, 0.9, 0x3a4a5a, 6).translateY(0.6));
          break;
        }
        case 'conveyor': {
          const belt = box(1, 0.08, 1, 0x2a2420, 0.04);
          const arrow = cone(0.2, 0.5, PALETTE.ember, 3);
          arrow.rotation.x = Math.PI / 2;
          arrow.rotation.z = (-f.dir * Math.PI) / 2 - Math.PI / 2;
          arrow.position.y = 0.12;
          g.add(belt, arrow);
          break;
        }
        case 'crack':
          g.add(ico(0.2, 0x3b4e5c));
          break;
      }
      this.items.push(v);
      this.group.add(g);
    });
    // Exits: an arch, with a glowing barrier while the room is uncleared.
    for (const ex of w.room.exits) {
      const g = new THREE.Group();
      g.position.set(ex.x, 0, ex.z);
      g.add(box(0.4, 3, 0.4, 0x59636e, 1.5, -1.3), box(0.4, 3, 0.4, 0x59636e, 1.5, 1.3), box(3, 0.4, 0.5, 0x8a96a3, 3.1));
      const barrier = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.8), new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      barrier.position.y = 1.4;
      const arrowMark = glow(0.12, PALETTE.rune, 2);
      arrowMark.position.y = 3.6;
      g.add(barrier, arrowMark);
      this.exits.push({ obj: g, kind: 'exit', i: this.exits.length, barrier, glow: arrowMark, phase: 0 });
      this.group.add(g);
    }
    // Everything that never moves is merged room-wide: twenty conveyor tiles cost two draw calls.
    const animated = new Set<THREE.Object3D>();
    for (const v of [...this.items, ...this.exits]) {
      if (v.glow) animated.add(v.glow);
      if (v.barrier) animated.add(v.barrier);
      if (v.lid) animated.add(v.lid);
    }
    const baked = bakeStatic(this.group, animated);
    const merged: THREE.Mesh[] = [];
    this.group.traverse((o) => bakeable(o, animated) && merged.push(o));
    for (const m of merged) m.removeFromParent();
    this.group.add(baked);
  }

  sync(w: World, dt: number): void {
    this.t += dt;
    for (const v of this.items) {
      const f = w.room.features[v.i];
      if (!f) continue;
      if (v.kind === 'waystone' && v.glow) v.glow.scale.y = 4 + Math.sin(this.t * 2) * 0.4;
      if (v.kind === 'brazier' && v.glow) {
        v.glow.visible = f.a > 0;
        v.glow.scale.setScalar(1 + Math.sin(this.t * 13 + v.phase) * 0.1);
      }
      if (v.kind === 'vent' && v.glow) {
        // a: 0 idle, 1 warning, 2 venting.
        v.glow.scale.y = f.a === 2 ? 3 : 0.05;
        v.glow.position.y = f.a === 2 ? 0.9 : 0.06;
        (v.glow.material as THREE.MeshToonMaterial).emissiveIntensity = f.a === 1 ? 1.5 + Math.sin(this.t * 30) : 1.5;
      }
      if (v.kind === 'geyser' && v.glow) {
        v.glow.scale.y = f.a === 2 ? 4 : 0.1;
        v.glow.position.y = f.a === 2 ? 1.5 : 0.2;
      }
      if (v.kind === 'generator' && v.glow) v.glow.visible = f.a > 0;
      if (v.lid) v.lid.rotation.x = f.a ? -1.2 : 0;
      if (v.rig) applyPose(v.rig, { speed: 0, phase: 0, pose: null, t: 0, strike: 0, airborne: false, stun: 0, dead: false, aiming: false, hurt: 0 });
    }
    w.room.exits.forEach((ex, i) => {
      const v = this.exits[i];
      if (!v) return;
      v.barrier!.visible = !ex.open;
      v.glow!.visible = ex.open && !!ex.to;
      v.glow!.position.y = 3.6 + Math.sin(this.t * 3) * 0.1;
    });
    // Tethers: each mender to the ally it shields, a channelling guardian to the master it mends.
    const pts: number[] = [];
    for (const e of w.entities) {
      if (e.kind !== 'enemy' || e.dead || !e.ai || !e.ai.a || (e.def !== 'mender' && e.ai.st !== 'channel')) continue;
      const a = w.entities.find((x) => x.id === e.ai!.a);
      if (!a || a.dead) continue;
      pts.push(e.x, 1.4, e.z, a.x, a.y + a.h * 0.6, a.z);
    }
    this.tethers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.tethers.geometry.computeBoundingSphere();
  }
}

export { toon };
