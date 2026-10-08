import * as THREE from 'three';
import type { ContentDb } from '../../core/data/types';
import type { Entity, World } from '../../core/sim/types';
import { buildHumanoid, type Rig } from '../models/humanoid';
import { buildWeapon } from '../models/weapons';
import { blobShadow, glow } from '../models/kit';
import { applyPose } from '../anim/poses';
import { PALETTE, toon } from '../materials';
import { buildEnemy, type EnemyModel } from '../models/enemies';
import { buildNpc } from '../models/npcs';

interface View {
  id: number;
  kind: string;
  obj: THREE.Object3D;
  rig: Rig | null;
  enemy: EnemyModel | null;
  phase: number;
  melee: THREE.Object3D | null;
  meleeL: THREE.Object3D | null;
  ranged: THREE.Object3D | null;
  lastFire: number;
  flash: THREE.Mesh[];
  seen: number;
  deadAt: number;
}

const RARITY_COLOR: Record<string, number> = {
  worn: 0xa0a8b0,
  forged: 0xe6edf3,
  runed: 0x5aa9ff,
  ascendant: 0xc07bff,
  relic: 0xff9a3c,
};

export const CLASS_STYLE: Record<string, { body: number; trim: number; cape: number }> = {
  berserker: { body: 0x4a3a34, trim: 0x8fb4d6, cape: 0x7a2a26 },
  commando: { body: 0x34404a, trim: 0xa9b8c4, cape: 0x2d4a3a },
};

/** Keeps one scene object per sim entity, keyed by id, and moves it to the interpolated position. */
export class EntityViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private frame = 0;

  constructor(private readonly db: ContentDb) {}

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.obj);
    this.views.clear();
  }

  sync(w: World, alpha: number, dt: number): void {
    this.frame++;
    for (const e of w.entities) {
      let v = this.views.get(e.id);
      if (!v) {
        v = this.create(e, w);
        this.views.set(e.id, v);
        this.group.add(v.obj);
      }
      v.seen = this.frame;
      this.update(v, e, w, alpha, dt);
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) {
        this.group.remove(v.obj);
        this.views.delete(id);
      }
    }
  }

  get(id: number): THREE.Object3D | null {
    return this.views.get(id)?.obj ?? null;
  }

  private create(e: Entity, w: World): View {
    const v: View = { id: e.id, kind: e.kind, obj: new THREE.Group(), rig: null, enemy: null, phase: 0, melee: null, meleeL: null, ranged: null, lastFire: -999, flash: [], seen: 0, deadAt: -1 };
    if (e.kind === 'player') {
      const slot = w.players.find((p) => p.entity === e.id);
      const cls = slot?.character.cls ?? 'berserker';
      const st = CLASS_STYLE[cls] ?? CLASS_STYLE.berserker!;
      const align = slot?.character.alignment;
      const rig = buildHumanoid({
        body: st.body,
        trim: align === 'cyber' ? 0x9fd8ff : align === 'human' ? 0xd8c8a0 : st.trim,
        skin: 0xc9a68a,
        eye: align === 'human' ? PALETTE.human : PALETTE.cyber,
        bulk: cls === 'berserker' ? 1.1 : 1,
        height: 1.85,
        helm: 'sworn',
        cape: st.cape,
        cyber: align === 'cyber' ? 2 : align === 'human' ? 0 : 1,
      });
      v.rig = rig;
      v.obj.add(rig.root, blobShadow(0.45));
      const stats = slot?.stats;
      const meleeKind = stats?.meleeKind ?? 'sword';
      const rangedKind = stats?.rangedKind ?? 'pistols';
      v.melee = buildWeapon(meleeKind);
      v.melee.rotation.x = Math.PI / 2;
      rig.handR.add(v.melee);
      if (meleeKind === 'blades') {
        v.meleeL = buildWeapon('blades');
        v.meleeL.rotation.x = Math.PI / 2;
        rig.handL.add(v.meleeL);
      }
      v.ranged = buildWeapon(rangedKind);
      v.ranged.visible = false;
      rig.handR.add(v.ranged);
      v.ranged.rotation.x = Math.PI / 2;
      rig.root.traverse((o) => o instanceof THREE.Mesh && v.flash.push(o));
    } else if (e.kind === 'enemy') {
      const def = this.db.enemies[e.def];
      v.enemy = buildEnemy(def?.model ?? e.def, def?.color ?? '#888888', e.elite ?? []);
      v.rig = v.enemy.rig;
      v.obj.add(v.enemy.root, blobShadow(e.r));
    } else if (e.kind === 'projectile') {
      const def = this.db.projectiles[e.def];
      const c = new THREE.Color(def?.color ?? '#ffffff').getHex();
      const m = glow(Math.max(0.08, (def?.radius ?? 0.15) * 0.8), c, 3);
      m.scale.z = 2.2;
      v.obj.add(m);
    } else if (e.kind === 'pickup') {
      const rar = e.pick?.item?.rarity ?? (e.pick?.kind === 'bounty' ? 'bounty' : e.pick?.kind === 'shade' ? 'shade' : 'worn');
      const color = rar === 'bounty' ? PALETTE.gold : rar === 'shade' ? 0xb8a0ff : e.pick?.kind === 'rune' ? PALETTE.rune : e.pick?.kind === 'heal' ? PALETTE.human : (RARITY_COLOR[rar] ?? 0xffffff);
      const gem = glow(e.pick?.kind === 'bounty' ? 0.12 : 0.2, color, 2.2);
      gem.position.y = 0.45;
      v.obj.add(gem);
      if (e.pick?.item && (rar === 'ascendant' || rar === 'relic' || rar === 'runed')) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }));
        beam.position.y = 1.5;
        v.obj.add(beam);
      }
    } else if (e.kind === 'npc') {
      const n = buildNpc(e.def);
      v.rig = n;
      v.obj.add(n.root, blobShadow(0.45));
    } else {
      v.obj.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), toon(0x888888)));
    }
    return v;
  }

  private update(v: View, e: Entity, w: World, alpha: number, dt: number): void {
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    const z = e.pz + (e.z - e.pz) * alpha;
    v.obj.position.set(x, y, z);
    if (e.kind === 'pickup') {
      v.obj.rotation.y += dt * 2;
      v.obj.position.y = y + Math.sin(performance.now() / 300 + e.id) * 0.08;
      return;
    }
    if (e.kind === 'projectile') {
      v.obj.rotation.y = Math.atan2(e.vx, e.vz);
      return;
    }
    const facing = Math.atan2(e.fx, e.fz);
    if (v.rig) {
      v.rig.root.rotation.y = facing;
      const speed = Math.hypot(e.vx, e.vz);
      v.phase += speed * dt * 1.6;
      const def = e.act ? this.db.actions[e.act.id] : null;
      const len = def?.len ?? 1;
      const strike = def && def.hits.length ? def.hits[0]!.from / len : def?.shoot ? (def.shoot.at[0] ?? 0) / len : 0.4;
      const p = w.players.find((pp) => pp.entity === e.id);
      const firing = !!p && (p.lastInput.held & (1 << 4)) !== 0;
      if (firing) v.lastFire = w.tick;
      const aiming = w.tick - v.lastFire < 20;
      if (v.ranged && v.melee) {
        v.ranged.visible = aiming && !e.act;
        v.melee.visible = !v.ranged.visible;
        if (v.meleeL) v.meleeL.visible = !v.ranged.visible;
      }
      applyPose(v.rig, {
        speed: e.act ? 0 : speed,
        phase: v.phase,
        pose: def ? def.pose : null,
        t: e.act ? Math.min(1, (e.act.t + alpha) / len) : 0,
        strike,
        airborne: e.y > 0.1,
        stun: e.stun,
        dead: e.dead,
        aiming,
        hurt: Math.max(0, 1 - (w.tick - e.hurtAt) / 8),
      });
      v.enemy?.update?.(e, w);
    }
    // Hit flash: brief emissive pop on the whole model.
    const flash = w.tick - e.hurtAt < 4;
    if (v.enemy) v.enemy.flash(flash);
    if (e.iframes && e.kind === 'player') v.obj.visible = (Math.floor(w.tick / 2) % 2 === 0) || true;
  }
}
