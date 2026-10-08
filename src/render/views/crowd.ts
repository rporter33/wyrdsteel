import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonVertex } from '../materials';
import { buildEnemy, type EnemyModel } from '../models/enemies';
import type { Rig } from '../models/humanoid';

const CAP = 64;
const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

interface Template {
  model: string;
  /** Pivots in traversal order; proxies mirror this list. */
  nodes: THREE.Object3D[];
  parents: number[];
  meshes: { node: number; lit: THREE.InstancedMesh | null; glow: THREE.InstancedMesh | null }[];
  rigIndex: Record<keyof Omit<Rig, 'scale'>, number> | null;
  scale: number;
  update: EnemyModel['update'];
  plateNodes: Record<string, number[]>;
}

/**
 * A pose-able copy of the model, never added to the scene: its rig is posed and its model hooks
 * run on it, and its node matrices feed the shared instanced meshes.
 */
export interface Proxy {
  holder: THREE.Object3D;
  model: EnemyModel;
  nodes: THREE.Object3D[];
  slot: number;
  flash: number;
}

function colorOf(m: THREE.Mesh): THREE.Color {
  const mat = m.material as THREE.MeshToonMaterial;
  return mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
}

function isGlow(m: THREE.Mesh): boolean {
  const mat = m.material as THREE.MeshToonMaterial;
  return (mat.emissiveIntensity ?? 0) > 0 || mat instanceof THREE.MeshBasicMaterial;
}

/** Bake a node's direct child meshes into one vertex-coloured geometry in the node's local space. */
function bake(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  if (!meshes.length) return null;
  const parts = meshes.map((m) => {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    g.deleteAttribute('uv');
    const c = colorOf(m);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(parts, false);
}

/**
 * Enemies of one type share an instanced mesh per body part, so forty thralls cost the same
 * handful of draw calls as one. Each enemy is posed through a light proxy skeleton.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private free = new Map<string, number[]>();
  private used = new Map<string, number>();
  private readonly m = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly flashColor = new THREE.Color(2.2, 2.0, 1.9);
  private readonly white = new THREE.Color(1, 1, 1);

  private template(model: string, color: string): Template {
    const key = `${model}|${color}`;
    let t = this.templates.get(key);
    if (t) return t;
    const built = buildEnemy(model, color, []);
    const nodes: THREE.Object3D[] = [];
    const parents: number[] = [];
    const walk = (o: THREE.Object3D, parent: number) => {
      if (o instanceof THREE.Mesh) return;
      const idx = nodes.length;
      nodes.push(o);
      parents.push(parent);
      for (const c of o.children) walk(c, idx);
    };
    walk(built.root, -1);
    const meshes: Template['meshes'] = [];
    nodes.forEach((n, i) => {
      const kids = n.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c.material as THREE.Material).transparent);
      const lit = bake(kids.filter((k) => !isGlow(k)));
      const glow = bake(kids.filter((k) => isGlow(k)));
      if (!lit && !glow) return;
      const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material) => {
        if (!g) return null;
        const im = new THREE.InstancedMesh(g, mat, CAP);
        im.count = 0;
        im.frustumCulled = false;
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
        for (let k = 0; k < CAP; k++) im.setMatrixAt(k, this.zero);
        this.group.add(im);
        return im;
      };
      meshes.push({ node: i, lit: mk(lit, toonVertex()), glow: mk(glow, GLOW_MAT) });
    });
    // Elite rings and other transparent bits are drawn per enemy, not instanced.
    let rigIndex: Template['rigIndex'] = null;
    if (built.rig) {
      const r = built.rig;
      const idx = (o: THREE.Object3D) => nodes.indexOf(o);
      rigIndex = { root: idx(r.root), hips: idx(r.hips), torso: idx(r.torso), head: idx(r.head), armL: idx(r.armL), armR: idx(r.armR), foreL: idx(r.foreL), foreR: idx(r.foreR), legL: idx(r.legL), legR: idx(r.legR), handL: idx(r.handL), handR: idx(r.handR) };
    }
    const plateNodes: Record<string, number[]> = {};
    nodes.forEach((n, i) => {
      if (n.name.startsWith('plate:')) (plateNodes[n.name.slice(6)] ??= []).push(i);
    });
    t = { model, nodes, parents, meshes, rigIndex, scale: built.rig?.scale ?? 1, update: built.update, plateNodes };
    this.templates.set(key, t);
    this.free.set(key, Array.from({ length: CAP }, (_, i) => CAP - 1 - i));
    this.used.set(key, 0);
    return t;
  }

  /** Allocate an instance slot and a proxy model for a new enemy. */
  acquire(model: string, color: string, elites: string[]): { proxy: Proxy; key: string } | null {
    this.template(model, color);
    const key = `${model}|${color}`;
    const slot = this.free.get(key)!.pop();
    if (slot === undefined) return null;
    const built = buildEnemy(model, color, elites);
    const nodes: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) return;
      nodes.push(o);
      for (const c of o.children) walk(c);
    };
    walk(built.root);
    const holder = new THREE.Object3D();
    holder.add(built.root);
    this.used.set(key, Math.max(this.used.get(key)!, slot + 1));
    return { proxy: { holder, model: built, nodes, slot, flash: 0 }, key };
  }

  release(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    for (const mm of t.meshes) {
      mm.lit?.setMatrixAt(proxy.slot, this.zero);
      mm.glow?.setMatrixAt(proxy.slot, this.zero);
      if (mm.lit) mm.lit.instanceMatrix.needsUpdate = true;
      if (mm.glow) mm.glow.instanceMatrix.needsUpdate = true;
    }
    this.free.get(key)!.push(proxy.slot);
  }

  /** Copy a posed proxy's world matrices into its instance slot. Call after posing. */
  write(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    proxy.holder.updateMatrixWorld(true);
    const color = proxy.flash > 0 ? this.flashColor : this.white;
    for (const mm of t.meshes) {
      const n = proxy.nodes[mm.node];
      if (!n) continue;
      for (const im of [mm.lit, mm.glow]) {
        if (!im) continue;
        im.setMatrixAt(proxy.slot, n.matrixWorld);
        im.setColorAt(proxy.slot, color);
        im.count = Math.max(im.count, this.used.get(key)!);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }
}
