import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonVertex } from '../materials';
import { buildEnemy, type EnemyModel } from '../models/enemies';

const CAP = 64;

interface Template {
  /** Pivot count; each instance owns this many matrices in the node texture. */
  nodeCount: number;
  lit: THREE.InstancedMesh | null;
  glow: THREE.InstancedMesh | null;
  data: Float32Array;
  tex: THREE.DataTexture;
}

/**
 * A pose-able copy of the model, never added to the scene: its rig is posed and its model hooks
 * run on it, and its node matrices feed the shared instanced mesh.
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

/** The pivots of a model in traversal order: every non-mesh object. Proxies mirror this list. */
function pivots(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) return;
    out.push(o);
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

/** Bake meshes into one vertex-coloured geometry in their pivot's local space, tagged with the pivot index. */
function bake(parts: { mesh: THREE.Mesh; node: number }[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map(({ mesh, node }) => {
    mesh.updateMatrix();
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = colorOf(mesh);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aNode', new THREE.BufferAttribute(new Float32Array(n).fill(node), 1));
    return g;
  });
  return mergeGeometries(geos, false);
}

/**
 * Patch a material so each vertex is moved by its pivot's world matrix, read from a float texture
 * row per instance. Rigid-part skinning, in effect: one draw call poses every copy of a model.
 */
function nodeSkinned<M extends THREE.Material>(base: M, tex: THREE.DataTexture, normals: boolean): M {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.nodeTex = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aNode;
uniform highp sampler2D nodeTex;
mat4 nodeMatrix() {
  int x = int(aNode + 0.5) * 4;
  return mat4(texelFetch(nodeTex, ivec2(x, gl_InstanceID), 0), texelFetch(nodeTex, ivec2(x + 1, gl_InstanceID), 0),
    texelFetch(nodeTex, ivec2(x + 2, gl_InstanceID), 0), texelFetch(nodeTex, ivec2(x + 3, gl_InstanceID), 0));
}`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (nodeMatrix() * vec4(transformed, 1.0)).xyz;');
    if (normals) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(nodeMatrix()) * objectNormal;');
  };
  m.customProgramCacheKey = () => `node-skinned-${normals}`;
  return m;
}

const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/**
 * Every copy of a model shares one instanced mesh (two when it has glowing parts), so forty thralls
 * cost the same draw calls as one, and so does the player. Each copy is posed through a light proxy
 * whose pivot matrices are uploaded to a texture the vertex shader reads.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private free = new Map<string, number[]>();
  private used = new Map<string, number>();
  private readonly flashColor = new THREE.Color(2.2, 2.0, 1.9);
  private readonly white = new THREE.Color(1, 1, 1);

  private template(key: string, build: () => EnemyModel): Template {
    let t = this.templates.get(key);
    if (t) return t;
    const built = build();
    const nodes = pivots(built.root);
    const lit: { mesh: THREE.Mesh; node: number }[] = [];
    const glow: { mesh: THREE.Mesh; node: number }[] = [];
    nodes.forEach((n, i) => {
      for (const c of n.children) {
        // Elite rings and other transparent bits are drawn per enemy, not instanced.
        if (!(c instanceof THREE.Mesh) || (c.material as THREE.Material).transparent) continue;
        (isGlow(c) ? glow : lit).push({ mesh: c, node: i });
      }
    });
    const data = new Float32Array(CAP * nodes.length * 16);
    const tex = new THREE.DataTexture(data, nodes.length * 4, CAP, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material, normals: boolean) => {
      if (!g) return null;
      const im = new THREE.InstancedMesh(g, nodeSkinned(mat, tex, normals), CAP);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      this.group.add(im);
      return im;
    };
    t = { nodeCount: nodes.length, lit: mk(bake(lit), toonVertex(), true), glow: mk(bake(glow), GLOW_MAT, false), data, tex };
    this.templates.set(key, t);
    this.free.set(key, Array.from({ length: CAP }, (_, i) => CAP - 1 - i));
    this.used.set(key, 0);
    return t;
  }

  /** Allocate an instance slot and a proxy model for a new enemy. */
  acquire(model: string, color: string, elites: string[]): { proxy: Proxy; key: string } | null {
    return this.acquireWith(`${model}|${color}`, (el) => buildEnemy(model, color, el), elites);
  }

  /**
   * Any model: the key groups copies that share geometry, and the builder makes one. Copies must
   * have the same pivots; hide a part by scaling its pivot to zero, not with `visible`.
   */
  acquireWith(key: string, build: (elites: string[]) => EnemyModel, elites: string[] = []): { proxy: Proxy; key: string } | null {
    this.template(key, () => build([]));
    const slot = this.free.get(key)!.pop();
    if (slot === undefined) return null;
    const built = build(elites);
    const holder = new THREE.Object3D();
    holder.add(built.root);
    this.used.set(key, Math.max(this.used.get(key)!, slot + 1));
    return { proxy: { holder, model: built, nodes: pivots(built.root), slot, flash: 0 }, key };
  }

  release(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    // Zero matrices collapse the copy to a point, so a freed slot draws nothing.
    t.data.fill(0, proxy.slot * t.nodeCount * 16, (proxy.slot + 1) * t.nodeCount * 16);
    t.tex.needsUpdate = true;
    this.free.get(key)!.push(proxy.slot);
  }

  /** Copy a posed proxy's world matrices into its row of the node texture. Call after posing. */
  write(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    proxy.holder.updateMatrixWorld(true);
    const base = proxy.slot * t.nodeCount * 16;
    for (let i = 0; i < t.nodeCount; i++) {
      const n = proxy.nodes[i];
      if (n) t.data.set(n.matrixWorld.elements, base + i * 16);
    }
    t.tex.needsUpdate = true;
    const color = proxy.flash > 0 ? this.flashColor : this.white;
    const count = this.used.get(key)!;
    for (const im of [t.lit, t.glow]) {
      if (!im) continue;
      im.setColorAt(proxy.slot, color);
      im.count = count;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
