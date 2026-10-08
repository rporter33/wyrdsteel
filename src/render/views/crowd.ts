import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceVertex, isGlowing } from '../materials';
import { buildEnemy, type EnemyModel } from '../models/enemies';

const CAP = 64;

interface Template {
  /** Node count; each instance owns this many matrices in the node texture. */
  nodeCount: number;
  /** Inverse of each node's world matrix in the rest pose: rest-space vertices to node space. */
  bindInverse: THREE.Matrix4[];
  meshes: THREE.InstancedMesh[];
  data: Float32Array;
  tex: THREE.DataTexture;
}

/**
 * A pose-able copy of the model, never added to the scene: its skeleton is animated and its model
 * hooks run on it, and its node matrices feed the shared instanced meshes.
 */
export interface Proxy {
  holder: THREE.Object3D;
  model: EnemyModel;
  nodes: THREE.Object3D[];
  slot: number;
  flash: number;
}

/** The nodes of a model in traversal order: every non-mesh object (pivots, bones). Proxies mirror this list. */
function nodesOf(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) return;
    out.push(o);
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

type Kind = 'lit' | 'metal' | 'glow' | string;

/** What a part is drawn with: textured parts keep their own material; the rest share vertex-coloured ones. */
function kindOf(mat: THREE.Material): Kind {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.map) return `tex:${m.uuid}`;
  if (isGlowing(mat)) return 'glow';
  return (m.metalness ?? 0) >= 0.5 ? 'metal' : 'lit';
}

/** A copy of an attribute as plain floats (glTF attributes may be quantized integers). */
function f32(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count;
  const k = a.itemSize;
  const out = new Float32Array(n * k);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = get[c]!.call(a, i);
  return new THREE.BufferAttribute(out, k);
}

/**
 * One mesh's geometry in rest-pose model space with four bone influences per vertex. Skinned
 * meshes are skinned once at rest (their raw positions may be quantized, with the scale folded
 * into the inverse bind matrices) and keep their weights, re-indexed into the node list. Rigid
 * parts get the nearest node above them at full weight. Untextured parts get their material's
 * colour as vertex colour.
 */
function bakePart(mesh: THREE.Mesh, nodes: THREE.Object3D[], textured: boolean, clothing?: EnemyModel['clothing']): THREE.BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const n = src.getAttribute('position').count;
  const g = new THREE.BufferGeometry();
  const pos = f32(src.getAttribute('position'));
  const nor = src.getAttribute('normal') ? f32(src.getAttribute('normal')) : null;
  if (mesh instanceof THREE.SkinnedMesh) {
    const { bones, boneInverses } = mesh.skeleton;
    const K = bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, boneInverses[j]!).multiply(mesh.bindMatrix));
    const si = src.getAttribute('skinIndex');
    const sw = src.getAttribute('skinWeight');
    const idx = new Float32Array(n * 4);
    const wts = new Float32Array(n * 4);
    const map = bones.map((b) => Math.max(0, nodes.indexOf(b)));
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const acc = new THREE.Vector3();
    const accN = new THREE.Vector3();
    const get = [si.getX, si.getY, si.getZ, si.getW];
    const getW = [sw.getX, sw.getY, sw.getZ, sw.getW];
    for (let i = 0; i < n; i++) {
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      let total = 0;
      for (let c = 0; c < 4; c++) {
        const w = getW[c]!.call(sw, i);
        const b = get[c]!.call(si, i);
        idx[i * 4 + c] = map[b] ?? 0;
        wts[i * 4 + c] = w;
        if (w <= 0) continue;
        total += w;
        acc.addScaledVector(v.fromBufferAttribute(pos, i).applyMatrix4(K[b]!), w);
        if (nor) accN.addScaledVector(nv.fromBufferAttribute(nor, i).transformDirection(K[b]!), w);
      }
      if (total > 0) acc.multiplyScalar(1 / total);
      pos.setXYZ(i, acc.x, acc.y, acc.z);
      if (nor) {
        accN.normalize();
        nor.setXYZ(i, accN.x, accN.y, accN.z);
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
  } else {
    pos.applyMatrix4(mesh.matrixWorld);
    nor?.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
    // Rigid parts ride the nearest node above them (a mesh may hang off another mesh).
    let p = mesh.parent;
    while (p && !nodes.includes(p)) p = p.parent;
    const node = p ? nodes.indexOf(p) : 0;
    const idx = new Float32Array(n * 4);
    const wts = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = node;
      wts[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
  }
  g.setAttribute('position', pos);
  if (nor) {
    for (let i = 0; i < n; i++) {
      const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      nor.setXYZ(i, x / l, y / l, z / l);
    }
    g.setAttribute('normal', nor);
  } else g.computeVertexNormals();
  if (textured) {
    const uv = src.getAttribute('uv');
    if (uv) g.setAttribute('uv', f32(uv));
    if (clothing) {
      const cl = new Float32Array(n * 4);
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) cl.set(clothing(v.fromBufferAttribute(pos, i)), i * 4);
      g.setAttribute('clothc', new THREE.BufferAttribute(cl, 4));
    }
  } else {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const vc = src.getAttribute('color');
    const col = new Float32Array(n * 3);
    const c = mat.color ?? new THREE.Color(0xffffff);
    for (let i = 0; i < n; i++) {
      if (vc && mat.vertexColors) col.set([vc.getX(i) * c.r, vc.getY(i) * c.g, vc.getZ(i) * c.b], i * 3);
      else col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

/**
 * Patch a material so each vertex is skinned by up to four node matrices read from a float texture,
 * one row per instance: GPU skinning for every copy of a model in one draw call. The stock skinning
 * path is per object; this one is per instance.
 */
function nodeSkinned<M extends THREE.Material>(base: M, tex: THREE.DataTexture, normals: boolean, cloth = false): M {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    if (cloth) {
      // Clothing: a per-vertex colour laid over the skin texture where the mask says so.
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 clothc;\nvarying vec4 vCloth;').replace('void main() {', 'void main() {\n  vCloth = clothc;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vCloth;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vCloth.rgb, vCloth.a);')
        // Fabric is matte and smooths over most of the skin's relief.
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, vCloth.a);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, vCloth.a * 0.7));');
    }
    shader.uniforms.nodeTex = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 skinIndex;
attribute vec4 skinWeight;
uniform highp sampler2D nodeTex;
mat4 nodeMatrix(float i) {
  int x = int(i + 0.5) * 4;
  return mat4(texelFetch(nodeTex, ivec2(x, gl_InstanceID), 0), texelFetch(nodeTex, ivec2(x + 1, gl_InstanceID), 0),
    texelFetch(nodeTex, ivec2(x + 2, gl_InstanceID), 0), texelFetch(nodeTex, ivec2(x + 3, gl_InstanceID), 0));
}
mat4 crowdSkin() {
  mat4 m = skinWeight.x * nodeMatrix(skinIndex.x);
  if (skinWeight.y > 0.0) m += skinWeight.y * nodeMatrix(skinIndex.y);
  if (skinWeight.z > 0.0) m += skinWeight.z * nodeMatrix(skinIndex.z);
  if (skinWeight.w > 0.0) m += skinWeight.w * nodeMatrix(skinIndex.w);
  return m;
}`,
      )
      .replace('void main() {', 'void main() {\n  mat4 cSkin = crowdSkin();')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (cSkin * vec4(transformed, 1.0)).xyz;');
    if (normals) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(cSkin) * objectNormal;');
  };
  m.customProgramCacheKey = () => `crowd-skinned-${normals}-${cloth}`;
  return m;
}

const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const METAL_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.7, roughness: 0.5 });

/**
 * Every copy of a model shares one instanced mesh per material kind (lit, metal, glowing, and each
 * texture set), so forty thralls cost the same draw calls as one, and so does the player. Each copy
 * is posed through a proxy whose node matrices are uploaded to a texture the vertex shader reads.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private free = new Map<string, number[]>();
  private used = new Map<string, number>();
  private readonly flashColor = new THREE.Color(2.2, 2.0, 1.9);
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly m4 = new THREE.Matrix4();

  private template(key: string, build: () => EnemyModel): Template {
    let t = this.templates.get(key);
    if (t) return t;
    const built = build();
    built.root.updateMatrixWorld(true);
    const nodes = nodesOf(built.root);
    const bindInverse = nodes.map((n) => n.matrixWorld.clone().invert());
    const parts = new Map<Kind, { geos: THREE.BufferGeometry[]; mat: THREE.Material }>();
    built.root.traverse((o) => {
      // Elite rings and other transparent bits are drawn per enemy, not instanced.
      if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).transparent || !o.visible) return;
      const mat = o.material as THREE.Material;
      const kind = kindOf(mat);
      const textured = kind.startsWith('tex:');
      let p = parts.get(kind);
      if (!p) {
        // Textured parts keep their own material, without the vertex colours the bake drops.
        const own = textured ? Object.assign(mat.clone(), { vertexColors: false }) : null;
        p = { geos: [], mat: own ?? (kind === 'glow' ? GLOW_MAT : kind === 'metal' ? METAL_MAT : surfaceVertex()) };
        parts.set(kind, p);
      }
      p.geos.push(bakePart(o, nodes, textured, built.clothing?.bind(built)));
    });
    const data = new Float32Array(CAP * nodes.length * 16);
    const tex = new THREE.DataTexture(data, nodes.length * 4, CAP, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const meshes: THREE.InstancedMesh[] = [];
    for (const [kind, p] of parts) {
      const g = mergeGeometries(p.geos, false);
      if (!g) continue;
      const glowing = kind === 'glow';
      const im = new THREE.InstancedMesh(g, nodeSkinned(p.mat, tex, !glowing, !!g.getAttribute('clothc')), CAP);
      im.count = 0;
      im.frustumCulled = false;
      // Shadows go through a depth material with the same skinning, or they'd stay in the bind pose.
      im.castShadow = !glowing;
      im.receiveShadow = !glowing;
      im.customDepthMaterial = nodeSkinned(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), tex, false);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      this.group.add(im);
      meshes.push(im);
    }
    t = { nodeCount: nodes.length, bindInverse, meshes, data, tex };
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
   * have the same nodes; hide a part by scaling its node to zero, not with `visible`.
   */
  acquireWith(key: string, build: (elites: string[]) => EnemyModel, elites: string[] = []): { proxy: Proxy; key: string } | null {
    this.template(key, () => build([]));
    const slot = this.free.get(key)!.pop();
    if (slot === undefined) return null;
    const built = build(elites);
    const holder = new THREE.Object3D();
    holder.add(built.root);
    this.used.set(key, Math.max(this.used.get(key)!, slot + 1));
    return { proxy: { holder, model: built, nodes: nodesOf(built.root), slot, flash: 0 }, key };
  }

  release(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    // Zero matrices collapse the copy to a point, so a freed slot draws nothing.
    t.data.fill(0, proxy.slot * t.nodeCount * 16, (proxy.slot + 1) * t.nodeCount * 16);
    t.tex.needsUpdate = true;
    this.free.get(key)!.push(proxy.slot);
  }

  /** Copy a posed proxy's skinning matrices into its row of the node texture. Call after posing. */
  write(key: string, proxy: Proxy): void {
    const t = this.templates.get(key)!;
    proxy.holder.updateMatrixWorld(true);
    const base = proxy.slot * t.nodeCount * 16;
    for (let i = 0; i < t.nodeCount; i++) {
      const n = proxy.nodes[i];
      if (!n) continue;
      this.m4.multiplyMatrices(n.matrixWorld, t.bindInverse[i]!);
      t.data.set(this.m4.elements, base + i * 16);
    }
    t.tex.needsUpdate = true;
    const color = proxy.flash > 0 ? this.flashColor : this.white;
    const count = this.used.get(key)!;
    for (const im of t.meshes) {
      im.setColorAt(proxy.slot, color);
      im.count = count;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
