import * as THREE from 'three';
import type { ContentDb } from '../../core/data/types';
import type { Entity, World } from '../../core/sim/types';
import { buildHumanoid, type Rig } from '../models/humanoid';
import { buildWeapon } from '../models/weapons';
import { blobShadow, glow } from '../models/kit';
import { applyPose } from '../anim/poses';
import { PALETTE, surface } from '../materials';
import { buildNpc } from '../models/npcs';
import { CrowdRenderer, type Proxy } from './crowd';
import type { EnemyModel } from '../models/enemies';
import { SKINNED_ENEMIES, animInput, buildSkinnedEnemy, buildSkinnedHero, characterAssets, type SkinnedModel } from '../models/characters';

interface View {
  id: number;
  kind: string;
  obj: THREE.Object3D;
  rig: Rig | null;
  proxy: Proxy | null;
  crowdKey: string;
  shadowR: number;
  phase: number;
  melee: THREE.Object3D | null;
  meleeL: THREE.Object3D | null;
  ranged: THREE.Object3D | null;
  lastFire: number;
  seen: number;
  deadAt: number;
  /** Batched projectiles and pickups: their colour, size and whether a loot beam marks them. */
  color: THREE.Color | null;
  size: number;
  beam: boolean;
}

/** A pool of identical meshes drawn in one call, refilled every frame. */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private readonly cap: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  begin(): void {
    this.n = 0;
  }
  push(m: THREE.Matrix4, c: THREE.Color): void {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, m);
    this.mesh.setColorAt(this.n, c);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
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
const SHADOW_CAP = 160;

export class EntityViews {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private frame = 0;
  private crowd = new CrowdRenderer();
  private shadows: THREE.InstancedMesh;
  private barBg: THREE.InstancedMesh;
  private barFill: THREE.InstancedMesh;
  private bolts = new Batch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), 128);
  private gems = new Batch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), 96);
  private beams = new Batch(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 48);
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly m4 = new THREE.Matrix4();
  private readonly v3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  camera: THREE.Camera | null = null;
  /** Accessibility: hit flashes can be turned off. */
  flash = true;
  /** Skinned, animated characters (when their assets have loaded) instead of the rigid ones. */
  skinned = false;
  /** With real shadow maps the blob shadows under bodies are hidden. */
  set realShadows(on: boolean) {
    this.shadows.visible = !on;
  }

  constructor(private readonly db: ContentDb) {
    this.crowd.group.name = 'crowd';
    this.group.add(this.crowd.group);
    const blob = blobShadow(0.5);
    this.shadows = new THREE.InstancedMesh(blob.geometry, blob.material as THREE.Material, SHADOW_CAP);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    const bar = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.barBg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.8, depthTest: false }), 64);
    this.barFill = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), 64);
    this.barFill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    for (const b of [this.barBg, this.barFill]) {
      b.count = 0;
      b.frustumCulled = false;
      b.renderOrder = 20;
    }
    this.group.add(this.shadows, this.barBg, this.barFill, this.bolts.mesh, this.gems.mesh, this.beams.mesh);
  }

  clear(): void {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }

  private drop(v: View): void {
    this.group.remove(v.obj);
    if (v.proxy) this.crowd.release(v.crowdKey, v.proxy);
  }

  sync(w: World, alpha: number, dt: number): void {
    this.frame++;
    for (const e of w.entities) {
      let v = this.views.get(e.id);
      // A player who equips a different weapon type gets a rebuilt model.
      if (v && e.kind === 'player' && v.crowdKey !== playerKey(e, w)) {
        this.drop(v);
        this.views.delete(e.id);
        v = undefined;
      }
      if (!v) {
        v = this.create(e, w);
        v.obj.name = e.kind;
        this.views.set(e.id, v);
        this.group.add(v.obj);
      }
      v.seen = this.frame;
      this.update(v, e, w, alpha, dt);
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) {
        this.drop(v);
        this.views.delete(id);
      }
    }
    this.writeShadowsAndBars(w);
    this.writeBatches();
  }

  private writeBatches(): void {
    this.bolts.begin();
    this.gems.begin();
    this.beams.begin();
    for (const v of this.views.values()) {
      if (!v.color) continue;
      const o = v.obj;
      this.q.setFromAxisAngle(this.up, o.rotation.y);
      if (v.kind === 'projectile') {
        this.s3.set(v.size, v.size, v.size * 2.2);
        this.m4.compose(o.position, this.q, this.s3);
        this.bolts.push(this.m4, v.color);
        continue;
      }
      this.v3.set(o.position.x, o.position.y + 0.45, o.position.z);
      this.s3.setScalar(v.size);
      this.m4.compose(this.v3, this.q, this.s3);
      this.gems.push(this.m4, v.color);
      if (v.beam) {
        this.v3.set(o.position.x, 1.5, o.position.z);
        this.s3.setScalar(1);
        this.m4.compose(this.v3, this.q.identity(), this.s3);
        this.beams.push(this.m4, v.color);
      }
    }
    this.bolts.end();
    this.gems.end();
    this.beams.end();
  }

  private writeShadowsAndBars(w: World): void {
    let n = 0;
    let b = 0;
    const camQ = this.camera ? this.camera.quaternion : new THREE.Quaternion();
    const red = new THREE.Color(0xd04848);
    const gold = new THREE.Color(0xf5c542);
    const blue = new THREE.Color(0x9fd8ff);
    for (const v of this.views.values()) {
      if (v.shadowR <= 0 || n >= SHADOW_CAP) continue;
      const o = v.obj.position;
      this.v3.set(o.x, 0.03, o.z);
      const sc = v.shadowR * 2.6 * (1 - Math.min(0.6, o.y * 0.15));
      this.s3.set(sc, sc, 1);
      this.m4.compose(this.v3, this.qFlat, this.s3);
      this.shadows.setMatrixAt(n++, this.m4);
      // Enemy health bars: shown once hurt, always for elites.
      const e = w.entities.find((x) => x.id === v.id);
      if (!e || e.kind !== 'enemy' || e.dead || b >= 64) continue;
      const def = this.db.enemies[e.def];
      if (!def || def.brain === 'dummy') continue;
      if (e.hp >= e.hpMax && !e.elite && e.shield <= 0) continue;
      const width = Math.min(2.4, 0.8 + e.r);
      const y = o.y + e.h + 0.45;
      this.v3.set(o.x - width / 2, y, o.z);
      this.s3.set(width, 0.13, 1);
      this.m4.compose(this.v3, camQ, this.s3);
      this.barBg.setMatrixAt(b, this.m4);
      const frac = Math.max(0, e.hp / e.hpMax);
      this.s3.set(width * frac, 0.1, 1);
      this.m4.compose(this.v3, camQ, this.s3);
      this.barFill.setMatrixAt(b, this.m4);
      this.barFill.setColorAt(b, e.shield > 0 ? blue : e.elite ? gold : red);
      b++;
    }
    this.shadows.count = n;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.barBg.count = this.barFill.count = b;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFill.instanceMatrix.needsUpdate = true;
    if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true;
  }

  get(id: number): THREE.Object3D | null {
    return this.views.get(id)?.obj ?? null;
  }

  private create(e: Entity, w: World): View {
    const v: View = { id: e.id, kind: e.kind, obj: new THREE.Group(), rig: null, proxy: null, crowdKey: '', shadowR: 0, phase: 0, melee: null, meleeL: null, ranged: null, lastFire: -999, seen: 0, deadAt: -1, color: null, size: 0, beam: false };
    const sk = this.skinned && !!characterAssets();
    if (e.kind === 'player') {
      const key = playerKey(e, w);
      const got = sk ? this.crowd.acquireWith(`sk|${key}`, () => buildSkinnedPlayer(key)) : this.crowd.acquireWith(key, () => buildPlayer(key));
      if (got) {
        v.proxy = got.proxy;
        v.crowdKey = got.key;
        v.rig = got.proxy.model.rig;
        v.melee = got.proxy.model.root.getObjectByName('melee') ?? null;
        v.meleeL = got.proxy.model.root.getObjectByName('meleeL') ?? null;
        v.ranged = got.proxy.model.root.getObjectByName('ranged') ?? null;
      }
      v.shadowR = 0.45;
    } else if (e.kind === 'enemy') {
      const def = this.db.enemies[e.def];
      const model = def?.model ?? e.def;
      const color = def?.color ?? '#888888';
      const got =
        sk && SKINNED_ENEMIES.has(model)
          ? this.crowd.acquireWith(`sk|${model}|${color}`, (el) => buildSkinnedEnemy(model, color, el), e.elite ?? [])
          : this.crowd.acquire(model, color, e.elite ?? []);
      if (got) {
        v.proxy = got.proxy;
        v.crowdKey = got.key;
        v.rig = got.proxy.model.rig;
        // Elite rings are transparent, so they are drawn per enemy rather than instanced.
        got.proxy.model.root.traverse((o) => {
          if (o instanceof THREE.Mesh && (o.material as THREE.Material).transparent) v.obj.add(o.clone());
        });
      }
      v.shadowR = e.r;
    } else if (e.kind === 'projectile') {
      const def = this.db.projectiles[e.def];
      v.color = new THREE.Color(def?.color ?? '#ffffff');
      v.size = Math.max(0.08, (def?.radius ?? 0.15) * 0.8);
    } else if (e.kind === 'pickup') {
      const rar = e.pick?.item?.rarity ?? (e.pick?.kind === 'bounty' ? 'bounty' : e.pick?.kind === 'shade' ? 'shade' : 'worn');
      v.color = new THREE.Color(rar === 'bounty' ? PALETTE.gold : rar === 'shade' ? 0xb8a0ff : e.pick?.kind === 'rune' ? PALETTE.rune : e.pick?.kind === 'heal' ? PALETTE.human : (RARITY_COLOR[rar] ?? 0xffffff));
      v.size = e.pick?.kind === 'bounty' ? 0.12 : 0.2;
      v.beam = !!e.pick?.item && (rar === 'ascendant' || rar === 'relic' || rar === 'runed');
    } else if (e.kind === 'npc') {
      const n = buildNpc(e.def);
      v.rig = n;
      v.shadowR = 0.45;
      v.obj.add(n.root);
    } else if (e.tur) {
      // Sentry turret: tripod and a rifle head that tracks its target.
      const head = new THREE.Group();
      head.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.8), surface(0x3f5468)));
      const muzzle = glow(0.07, 0x9be7ff, 2);
      muzzle.position.z = 0.45;
      head.add(muzzle);
      head.position.y = 1.0;
      head.name = 'head';
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5), surface(0x2a3038));
        leg.position.set(Math.cos(i * 2.09) * 0.25, 0.5, Math.sin(i * 2.09) * 0.25);
        leg.rotation.z = Math.cos(i * 2.09) * 0.35;
        leg.rotation.x = -Math.sin(i * 2.09) * 0.35;
        v.obj.add(leg);
      }
      v.obj.add(head);
      v.shadowR = 0.4;
    } else {
      v.obj.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), surface(0x888888)));
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
    if (e.tur) {
      const head = v.obj.getObjectByName('head');
      if (head) head.rotation.y = Math.atan2(e.fx, e.fz);
      return;
    }
    const facing = Math.atan2(e.fx, e.fz);
    if (v.proxy) {
      v.proxy.holder.position.copy(v.obj.position);
      v.proxy.holder.rotation.y = 0;
    }
    const anim = (v.proxy?.model as SkinnedModel | undefined)?.anim;
    if (v.rig || anim) {
      if (v.rig) v.rig.root.rotation.y = facing;
      const speed = Math.hypot(e.vx, e.vz);
      v.phase += speed * dt * 1.6;
      const def = e.act ? this.db.actions[e.act.id] : null;
      const len = def?.len ?? 1;
      const strike = def && def.hits.length ? def.hits[0]!.from / len : def?.shoot ? (def.shoot.at[0] ?? 0) / len : 0.4;
      const p = w.players.find((pp) => pp.entity === e.id);
      const firing = !!p && (p.lastInput.held & (1 << 4)) !== 0;
      if (firing) v.lastFire = w.tick;
      const aiming = w.tick - v.lastFire < 20;
      const gun = aiming && (!e.act || def?.pose === 'shoot');
      if (v.ranged && v.melee) {
        // Instanced parts hide by scale, not visibility.
        v.ranged.scale.setScalar(gun ? 1 : 0);
        v.melee.scale.setScalar(gun ? 0 : 1);
        v.meleeL?.scale.setScalar(gun ? 0 : 1);
      }
      if (anim) {
        v.proxy!.model.root.rotation.y = facing;
        anim.update(animInput(e, w, { pose: def ? def.pose : null, t: e.act ? Math.min(1, (e.act.t + alpha) / len) : 0, strike, aiming: aiming || (!!def && def.pose === 'shoot'), armed: !gun && e.kind === 'player' }), dt);
      } else applyPose(v.rig!, {
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
    }
    if (v.proxy) {
      if (!v.rig) v.proxy.model.root.rotation.y = facing;
      v.proxy.model.update?.(e, w);
      v.proxy.flash = this.flash && w.tick - e.hurtAt < 4 ? 1 : 0;
      // Burrowed enemies sink out of sight.
      if (e.ai && (e.ai.st === 'travel' || e.ai.st === 'burrowed')) v.proxy.holder.position.y = -3;
      this.crowd.write(v.crowdKey, v.proxy);
    }
  }
}

function playerKey(e: Entity, w: World): string {
  const slot = w.players.find((p) => p.entity === e.id);
  const cls = slot?.character.cls ?? 'berserker';
  return `player|${cls}|${slot?.character.alignment ?? ''}|${slot?.stats?.meleeKind ?? 'sword'}|${slot?.stats?.rangedKind ?? 'pistols'}`;
}

/** The Sworn: class colours, alignment trim and eyes, and the equipped weapon types on named pivots. */
function buildPlayer(key: string): EnemyModel {
  const [, cls = 'berserker', align, meleeKind = 'sword', rangedKind = 'pistols'] = key.split('|');
  const st = CLASS_STYLE[cls] ?? CLASS_STYLE.berserker!;
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
  const hold = (kind: string, hand: THREE.Object3D, name: string, shown: boolean) => {
    const g = buildWeapon(kind);
    g.rotation.x = Math.PI / 2;
    g.name = name;
    g.scale.setScalar(shown ? 1 : 0);
    hand.add(g);
  };
  hold(meleeKind, rig.handR, 'melee', true);
  if (meleeKind === 'blades') hold('blades', rig.handL, 'meleeL', true);
  hold(rangedKind, rig.handR, 'ranged', false);
  return { root: rig.root as THREE.Group, rig, flash: () => {} };
}

/** The skinned Sworn for a player key; a body per class until there is an appearance choice. */
function buildSkinnedPlayer(key: string): EnemyModel {
  const [, cls = 'berserker', align = '', meleeKind = 'sword', rangedKind = 'pistols'] = key.split('|');
  const st = CLASS_STYLE[cls] ?? CLASS_STYLE.berserker!;
  return buildSkinnedHero({
    cls,
    align,
    body: st.body,
    trim: align === 'cyber' ? 0x9fd8ff : align === 'human' ? 0xd8c8a0 : st.trim,
    cape: st.cape,
    meleeKind,
    rangedKind,
    female: cls === 'commando',
  });
}
