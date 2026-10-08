import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimEvent, World } from '../../core/sim/types';
import type { CameraRig } from '../camera';
import type { RenderOptions } from '../scene';

const MAX_P = 700;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  grav: number;
}

interface Num {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  life: number;
}

interface Trail {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

/** A telegraph on the ground. Timed in sim ticks, not wall time: when frames drop and the sim
 * slows, the warning still lasts exactly until the blow lands. */
interface Decal {
  mesh: THREE.Mesh;
  fill: THREE.Mesh;
  rim: THREE.Mesh;
  start: number;
  end: number;
}

/** A fading ribbon behind a swung blade: the last few hilt and tip positions, oldest first. */
interface Ribbon {
  mesh: THREE.Mesh;
  pts: { base: THREE.Vector3; tip: THREE.Vector3; age: number }[];
  color: THREE.Color;
  seen: boolean;
}
const RIBBON_N = 14;
const RIBBON_LIFE = 0.14;
/** Pose families that swing a blade (and so leave a ribbon). */
const SWINGS = new Set(['slashR', 'slashL', 'twin', 'thrust', 'overhead', 'uppercut', 'spin', 'slam', 'leap']);

/** A thin quad from (x1, y1) to (x2, y2) in the shape's plane. */
function band(x1: number, y1: number, x2: number, y2: number, hw: number): THREE.BufferGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * hw;
  const ny = (dx / l) * hw;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x1 + nx, y1 + ny, 0, x1 - nx, y1 - ny, 0, x2 - nx, y2 - ny, 0, x2 + nx, y2 + ny, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g.toNonIndexed();
}

/** The bright edge of a telegraph's shape, in the same plane as its fill. */
function rimOf(ev: Extract<SimEvent, { k: 'telegraph' }>): THREE.BufferGeometry {
  const w = 0.07;
  const parts: THREE.BufferGeometry[] = [];
  if (ev.shape === 'line') {
    const hx = ev.width / 2;
    parts.push(band(-hx, 0, hx, 0, w), band(hx, 0, hx, ev.len, w), band(hx, ev.len, -hx, ev.len, w), band(-hx, ev.len, -hx, 0, w));
  } else if (ev.shape === 'ring') {
    parts.push(new THREE.RingGeometry(Math.max(0.05, ev.r - ev.width), Math.max(0.1, ev.r - ev.width) + w, 48).toNonIndexed(), new THREE.RingGeometry(ev.r - w, ev.r, 48).toNonIndexed());
  } else if (ev.shape === 'cone') {
    const arc = ev.width > 0 ? Math.min(Math.PI * 2, ev.width) : 1.2;
    const a0 = Math.PI / 2 - arc / 2;
    parts.push(new THREE.RingGeometry(ev.r - w * 1.5, ev.r, 32, 1, a0, arc).toNonIndexed());
    if (arc < Math.PI * 2 - 0.01) for (const a of [a0, a0 + arc]) parts.push(band(0, 0, Math.cos(a) * ev.r, Math.sin(a) * ev.r, w / 2));
  } else parts.push(new THREE.RingGeometry(ev.r - w * 1.5, ev.r, 48).toNonIndexed());
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  return mergeGeometries(parts, false)!;
}

const STATUS_COLOR: Record<string, number> = { burn: 0xff8a3c, chill: 0x9be7ff, freeze: 0xcff4ff, root: 0xf5c542, shock: 0xc6a8ff };

/**
 * One particle pool, damage numbers, swing trails and telegraph decals. Purely cosmetic: driven by
 * sim events, never feeding back into the sim.
 */
export class Effects {
  private parts: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private nums: Num[] = [];
  private numHost: HTMLElement;
  private trails: Trail[] = [];
  private decals: Decal[] = [];
  private ribbons = new Map<number, Ribbon>();
  private readonly ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private reticle: THREE.Mesh;
  private softRing: THREE.Mesh;
  private lockMark: THREE.Group;

  constructor(
    readonly scene: THREE.Scene,
    readonly rig: CameraRig,
  ) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_P);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    scene.add(this.mesh);
    this.numHost = document.createElement('div');
    this.numHost.className = 'dmg-layer';
    document.getElementById('hud')?.appendChild(this.numHost);

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 24), new THREE.MeshBasicMaterial({ color: 0xe6edf3, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 10;
    this.softRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 32), new THREE.MeshBasicMaterial({ color: 0xe6edf3, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.softRing.rotation.x = -Math.PI / 2;
    this.lockMark = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: 0xe5484d, depthTest: false }));
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      b.position.set(Math.cos(a) * 1.1, 0.06, Math.sin(a) * 1.1);
      b.rotation.y = -a + Math.PI / 2;
      b.renderOrder = 11;
      this.lockMark.add(b);
    }
    scene.add(this.reticle, this.softRing, this.lockMark);
  }

  clear(): void {
    this.parts = [];
    for (const n of this.nums) n.el.remove();
    this.nums = [];
    for (const t of this.trails) this.scene.remove(t.mesh);
    this.trails = [];
    for (const d of this.decals) this.scene.remove(d.mesh);
    this.decals = [];
    for (const r of this.ribbons.values()) this.scene.remove(r.mesh);
    this.ribbons.clear();
  }

  /** A quick bright point where a blow lands, large enough for bloom to catch. */
  private flash(x: number, y: number, z: number, color: number, size: number): void {
    if (this.parts.length >= MAX_P) return;
    const c = new THREE.Color(color).multiplyScalar(3);
    this.parts.push({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.09, max: 0.09, size, color: c, grav: 0 });
  }

  /** Add this frame's blade position to its owner's ribbon (creating one on the first swing frame). */
  private sampleBlade(id: number, base: THREE.Vector3, tip: THREE.Vector3, color: number): void {
    let r = this.ribbons.get(id);
    if (!r) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RIBBON_N * 2 * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(RIBBON_N * 2 * 4), 4));
      const idx: number[] = [];
      for (let i = 0; i < RIBBON_N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.ribbonMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      r = { mesh, pts: [], color: new THREE.Color(color), seen: true };
      this.ribbons.set(id, r);
    }
    r.seen = true;
    r.pts.push({ base: base.clone(), tip: tip.clone(), age: 0 });
    if (r.pts.length > RIBBON_N) r.pts.shift();
  }

  /** Age ribbons, rebuild their strips, and drop the ones that have faded. */
  private updateRibbons(dt: number): void {
    for (const [id, r] of this.ribbons) {
      for (const p of r.pts) p.age += dt;
      r.pts = r.pts.filter((p) => p.age < RIBBON_LIFE);
      if (!r.pts.length && !r.seen) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        this.ribbons.delete(id);
        continue;
      }
      r.seen = false;
      const pos = r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = r.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const n = r.pts.length;
      for (let i = 0; i < RIBBON_N; i++) {
        // Unused slots collapse onto the newest sample.
        const p = r.pts[Math.min(i, n - 1)];
        if (!p) continue;
        pos.setXYZ(i * 2, p.base.x, p.base.y, p.base.z);
        pos.setXYZ(i * 2 + 1, p.tip.x, p.tip.y, p.tip.z);
        const a = i < n ? (1 - p.age / RIBBON_LIFE) * (i / Math.max(1, n - 1)) : 0;
        col.setXYZW(i * 2, r.color.r * 2, r.color.g * 2, r.color.b * 2, a * 0.15);
        col.setXYZW(i * 2 + 1, r.color.r * 2, r.color.g * 2, r.color.b * 2, a * 0.85);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      r.mesh.visible = n > 1;
    }
  }

  burst(x: number, y: number, z: number, color: number, n: number, speed: number, size = 0.07, grav = 9, life = 0.45): void {
    // Brighter than white, so the bloom pass gives sparks a glow.
    const c = new THREE.Color(color).multiplyScalar(1.8);
    for (let i = 0; i < n && this.parts.length < MAX_P; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8), color: c, grav });
    }
  }

  private number(x: number, y: number, z: number, text: string, cls: string): void {
    if (this.nums.length > 40) this.nums.shift()!.el.remove();
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.numHost.appendChild(el);
    this.nums.push({ el, x: x + (Math.random() - 0.5) * 0.4, y, z, life: 0.8 });
  }

  private trail(x: number, z: number, fx: number, fz: number, radius: number, arc: number, color: number, y = 1.1): void {
    const g = new THREE.RingGeometry(radius * 0.55, radius, 20, 1, -arc / 2, arc);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(fx, fz) - Math.PI / 2;
    m.position.set(x, y, z);
    this.scene.add(m);
    this.trails.push({ mesh: m, life: 0.16, max: 0.16 });
  }

  private telegraph(ev: Extract<SimEvent, { k: 'telegraph' }>, w: World, bold = false): void {
    void w;
    const col = bold ? 0xff2a6d : 0xe5484d;
    let shape: THREE.BufferGeometry;
    if (ev.shape === 'line') shape = new THREE.PlaneGeometry(ev.width, ev.len).translate(0, ev.len / 2, 0);
    else if (ev.shape === 'ring') shape = new THREE.RingGeometry(Math.max(0.1, ev.r - ev.width), ev.r, 40);
    else if (ev.shape === 'cone') {
      const arc = ev.width > 0 ? Math.min(Math.PI * 2, ev.width) : 1.2;
      shape = new THREE.CircleGeometry(ev.r, 32, Math.PI / 2 - arc / 2, arc);
    }
    else shape = new THREE.CircleGeometry(ev.r, 32);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: bold ? 0.36 : 0.18, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(shape, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(ev.dx, ev.dz) + Math.PI;
    if (ev.shape === 'line' || ev.shape === 'cone') mesh.rotation.z = -Math.atan2(ev.dx, -ev.dz);
    mesh.position.set(ev.x, 0.05, ev.z);
    const fill = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: bold ? 0.6 : 0.35, depthWrite: false, side: THREE.DoubleSide }));
    fill.scale.setScalar(0.01);
    mesh.add(fill);
    fill.position.z = 0.001;
    // A bright edge, so the shape reads at a glance on any floor; it pulses faster as the blow nears.
    const rim = new THREE.Mesh(rimOf(ev), new THREE.MeshBasicMaterial({ color: new THREE.Color(bold ? 0xff4a8a : 0xff5a4a).multiplyScalar(1.6), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    rim.position.z = 0.002;
    mesh.add(rim);
    this.scene.add(mesh);
    this.decals.push({ mesh, fill, rim, start: ev.t, end: ev.t + Math.max(6, ev.dur) });
  }

  /**
   * `blade` gives the hilt and tip of an entity's held blade this frame, when it has one; swings
   * by such entities leave ribbons that follow the blade instead of a flat arc.
   */
  update(w: World, events: SimEvent[], dt: number, opts: RenderOptions, get: (id: number) => THREE.Object3D | null, blade?: (id: number, base: THREE.Vector3, tip: THREE.Vector3) => boolean, db?: { actions: Record<string, { pose: string }> }): void {
    const ent = (id: number) => w.entities.find((e) => e.id === id);
    if (blade && db && !opts.lowFx) {
      const base = this.p.clone();
      const tip = this.s.clone();
      for (const e of w.entities) {
        if (e.kind !== 'player' || !e.act || e.dead) continue;
        const pose = db.actions[e.act.id]?.pose;
        if (pose && SWINGS.has(pose) && blade(e.id, base, tip)) this.sampleBlade(e.id, base, tip, 0x9fd8ff);
      }
    }
    this.updateRibbons(dt);
    for (const ev of events) {
      switch (ev.k) {
        case 'hit': {
          if (ev.dmg === 0) {
            this.burst(ev.x, ev.y, ev.z, 0xf5c542, 6, 5, 0.05);
            this.number(ev.x, ev.y + 0.6, ev.z, 'BLOCK', 'block');
            break;
          }
          const target = ent(ev.dst);
          const onPlayer = target?.kind === 'player';
          const color = ev.status ? (STATUS_COLOR[ev.status] ?? 0xffffff) : onPlayer ? 0xe5484d : ev.crit ? 0xffd24a : 0xffffff;
          this.burst(ev.x, ev.y, ev.z, color, opts.lowFx ? 3 : ev.heavy ? 18 : 8, ev.heavy ? 8 : 5);
          if (!opts.lowFx) this.flash(ev.x, ev.y, ev.z, color, ev.heavy ? 0.55 : 0.35);
          this.number(ev.x, ev.y + 0.8, ev.z, String(ev.dmg), (onPlayer ? 'taken' : ev.crit ? 'crit' : ev.weak ? 'weak' : '') + (ev.status ? ' st' : ''));
          if (ev.heavy) this.rig.addTrauma(onPlayer ? 0.35 : 0.22);
          else if (onPlayer) this.rig.addTrauma(0.18);
          else this.rig.addTrauma(0.05);
          break;
        }
        case 'swing': {
          const e = ent(ev.src);
          if (e && !opts.lowFx && !this.ribbons.has(e.id)) this.trail(e.x, e.z, e.fx, e.fz, 2.3, 2.0, e.kind === 'player' ? 0x9fd8ff : 0xffb0a0, e.y + 1.1);
          break;
        }
        case 'dodge':
          if (ev.perfect) {
            const e = ent(ev.src);
            if (e) this.burst(e.x, 1, e.z, 0x78c6ff, 24, 6, 0.06, 0);
            this.number(e?.x ?? 0, 2.4, e?.z ?? 0, 'PERFECT', 'perfect');
          }
          break;
        case 'death': {
          this.burst(ev.x, 0.8, ev.z, 0xffffff, opts.lowFx ? 6 : 26, 7, 0.08);
          break;
        }
        case 'partBreak': {
          const e = ent(ev.dst);
          if (e) {
            this.burst(e.x, 1.8, e.z, 0xf5c542, 30, 9, 0.1);
            this.number(e.x, 3.4, e.z, 'BROKEN', 'weak');
          }
          this.rig.addTrauma(0.35);
          break;
        }
        case 'shatter': {
          const e = ent(ev.dst);
          if (e) this.burst(e.x, 1, e.z, 0xcff4ff, 34, 9, 0.1);
          this.rig.addTrauma(0.3);
          break;
        }
        case 'land':
          if (ev.slam) {
            const e = ent(ev.dst);
            if (e) this.burst(e.x, 0.1, e.z, 0xcfd8e0, 20, 6, 0.08, 12);
            this.rig.addTrauma(0.25);
          }
          break;
        case 'hazard':
          if (ev.what.startsWith('blast')) {
            this.burst(ev.x, 0.6, ev.z, 0xff9a3c, opts.lowFx ? 8 : 40, 10, 0.1);
            this.rig.addTrauma(0.3);
          } else if (ev.what === 'shotdown') this.burst(ev.x, 1.2, ev.z, 0xcff4ff, 10, 5, 0.05);
          else if (ev.what === 'brazier') this.burst(ev.x, 1.1, ev.z, 0xff9a3c, 24, 4, 0.08, -2, 0.8);
          break;
        case 'telegraph':
          this.telegraph(ev, w, opts.boldTelegraphs);
          break;
        case 'immune': {
          const e = ent(ev.dst);
          if (e) this.number(e.x, e.y + e.h + 0.2, e.z, 'IMMUNE', 'block');
          break;
        }
        case 'status':
          if (ev.status === 'freeze') {
            const e = ent(ev.dst);
            if (e) this.number(e.x, e.y + e.h + 0.3, e.z, 'FROZEN', 'st');
          }
          break;
        case 'ruiner': {
          const e = ent(ev.src);
          if (e) this.burst(e.x, 1, e.z, 0x78c6ff, 60, 12, 0.12, 2, 0.8);
          this.rig.addTrauma(0.5);
          break;
        }
        case 'boss': {
          const b = w.entities.find((x) => x.boss);
          if (!b) break;
          if (ev.what === 'phase' && ev.value !== '1') {
            this.burst(b.x, 2.5, b.z, 0xff9a3c, opts.lowFx ? 12 : 70, 14, 0.14, 3, 1);
            this.rig.addTrauma(0.6);
          } else if (ev.what === 'broken') {
            this.burst(b.x, 3, b.z, 0x8a8f95, opts.lowFx ? 10 : 50, 9, 0.16, 2, 1);
            this.number(b.x, b.y + b.h + 0.4, b.z, 'PLATES BROKEN', 'crit');
          } else if (ev.what === 'plated') {
            this.number(b.x, b.y + b.h + 0.4, b.z, 'RE-PLATED', 'block');
          } else if (ev.what === 'exposed') {
            this.burst(b.x, 3.2, b.z, 0xffd27a, opts.lowFx ? 10 : 40, 6, 0.1, 4, 1.2);
            this.number(b.x, b.y + b.h + 0.4, b.z, 'HEART EXPOSED', 'crit');
          } else if (ev.what === 'interrupt') {
            const g = w.entities.find((x) => x.ai?.a === b.id && x.def !== b.def);
            if (g) this.number(g.x, g.y + g.h + 0.3, g.z, 'BROKEN SPELL', 'st');
          } else if (ev.what === 'collapse') {
            this.rig.addTrauma(0.7);
          } else if (ev.what === 'defeated') {
            this.burst(b.x, 2.5, b.z, 0xffd27a, opts.lowFx ? 20 : 120, 16, 0.18, 5, 1.6);
            this.rig.addTrauma(0.9);
          }
          break;
        }
      }
    }

    // Particles.
    let n = 0;
    const cam = this.rig.camera;
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.02, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const k = p.life / p.max;
      // Sparks stretch along their flight, so a burst reads as streaks rather than dots.
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const sz = p.size * (0.3 + 0.7 * k);
      if (speed > 0.5) {
        this.dir.set(p.vx / speed, p.vy / speed, p.vz / speed);
        this.q.setFromUnitVectors(this.up, this.dir);
        this.s.set(sz * 0.6, sz * (1 + Math.min(4, speed * 0.35)), sz * 0.6);
      } else {
        this.q.identity();
        this.s.setScalar(sz);
      }
      this.p.set(p.x, p.y, p.z);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Damage numbers float up and fade, projected to the screen.
    const rect = (this.numHost.parentElement ?? document.body).getBoundingClientRect();
    this.nums = this.nums.filter((num) => {
      num.life -= dt;
      if (num.life <= 0) {
        num.el.remove();
        return false;
      }
      num.y += dt * 1.4;
      this.p.set(num.x, num.y, num.z).project(cam);
      num.el.style.transform = `translate(${((this.p.x + 1) / 2) * rect.width}px, ${((1 - this.p.y) / 2) * rect.height}px) translate(-50%, -50%)`;
      num.el.style.opacity = String(Math.min(1, num.life * 2.5));
      return true;
    });

    this.trails = this.trails.filter((t) => {
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0, t.life / t.max);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        return false;
      }
      return true;
    });

    this.decals = this.decals.filter((d) => {
      const k = Math.min(1, (w.tick - d.start) / (d.end - d.start));
      d.fill.scale.setScalar(Math.max(0.01, k));
      (d.rim.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(w.tick * (0.25 + k * 0.6));
      if (w.tick >= d.end) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.rim.geometry.dispose();
        return false;
      }
      return true;
    });

    // Reticle, soft target ring, lock brackets for the local player.
    const p = w.players[0];
    const pe = p ? ent(p.entity) : null;
    if (pe && pe.pl && !pe.dead) {
      const inp = p!.lastInput;
      this.reticle.visible = inp.ax !== 0 || inp.az !== 0;
      if (this.reticle.visible) this.reticle.position.set(pe.x + inp.ax / 16, 1.2, pe.z + inp.az / 16);
      const soft = pe.pl.soft && pe.pl.soft !== pe.pl.lock ? ent(pe.pl.soft) : null;
      this.softRing.visible = !!soft && !soft.dead;
      if (soft) {
        const o = get(soft.id);
        this.softRing.position.set(o?.position.x ?? soft.x, 0.05, o?.position.z ?? soft.z);
        this.softRing.scale.setScalar(soft.r + 0.3);
      }
      const lock = pe.pl.lock ? ent(pe.pl.lock) : null;
      this.lockMark.visible = !!lock;
      if (lock) {
        const o = get(lock.id);
        this.lockMark.position.set(o?.position.x ?? lock.x, 0.05, o?.position.z ?? lock.z);
        this.lockMark.scale.setScalar(lock.r + 0.4);
        this.lockMark.rotation.y += dt * 1.5;
      }
    } else {
      this.reticle.visible = this.softRing.visible = this.lockMark.visible = false;
    }
  }
}
