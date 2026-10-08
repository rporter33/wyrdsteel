// Binds a character mesh (a generated model in T-pose, facing +Z) to the game's shared skeleton,
// so every clip in the library plays on it. The mesh is scaled to the reference mannequin's height;
// the skeleton's arms are then lengthened or shortened to the character's arm span (clips only turn
// joints, so bone lengths are free to differ per character), and each vertex takes its bone weights
// from the nearest points of the mannequin's skinned surface, fitted the same way. No rig from the
// generator is needed, and no clip retargeting.
//
// Used by build.mjs (`node scripts/assets/build.mjs generated`); see generate.mjs for the models.

import { mergeDocuments } from '@gltf-transform/functions';

// --- Column-major 4x4 matrices, as glTF stores them. ---
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function apply(m, x, y, z, w = 1) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

/** The reference body's surface at rest: each vertex's position and its four joint weights. */
function restSurface(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const K = joints.map((j, i) => mul(j.getWorldMatrix(), ibm.getElement(i, [])));
  const pts = [];
  const jw = [];
  for (const node of doc.getRoot().listNodes()) {
    if (node.getSkin() !== skin || !node.getMesh()) continue;
    for (const prim of node.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < P.getCount(); i++) {
        const v = P.getElement(i, []);
        const j = J.getElement(i, []);
        const w = W.getElement(i, []);
        const p = [0, 0, 0];
        let tot = 0;
        for (let k = 0; k < 4; k++) {
          if (w[k] <= 0) continue;
          const q = apply(K[j[k]], v[0], v[1], v[2]);
          p[0] += q[0] * w[k];
          p[1] += q[1] * w[k];
          p[2] += q[2] * w[k];
          tot += w[k];
        }
        pts.push(p[0] / tot, p[1] / tot, p[2] / tot);
        jw.push([j, w]);
      }
    }
  }
  return { skin, joints, pts: new Float32Array(pts), jw };
}

/** A uniform grid over points, for nearest-neighbour queries. */
function grid(pts, cell) {
  const map = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < pts.length / 3; i++) {
    const k = key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell));
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  }
  return (x, y, z, n) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let r = 1; r < 40; r++) {
      const found = [];
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (const i of map.get(key(cx + dx, cy + dy, cz + dz)) ?? []) found.push(i);
      if (found.length >= n) {
        return found
          .map((i) => [i, (pts[i * 3] - x) ** 2 + (pts[i * 3 + 1] - y) ** 2 + (pts[i * 3 + 2] - z) ** 2])
          .sort((a, b) => a[1] - b[1])
          .slice(0, n);
      }
    }
    return [];
  };
}

function bounds(pts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], pts[i + k])), (max[k] = Math.max(max[k], pts[i + k]));
  return { min, max };
}

/**
 * ref: a document holding the skinned reference body (its skeleton becomes the model's).
 * gen: a document holding the character to bind (unskinned, or its skin is ignored).
 * Returns `ref`, with its body replaced by the bound character.
 */
export function bindToSkeleton(ref, gen, log = console.log) {
  // The reference's clips are not needed (the game has them); samplers must go too, or prune keeps their data.
  for (const a of ref.getRoot().listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const smp of a.listSamplers()) smp.dispose();
    a.dispose();
  }
  const R = restSurface(ref);
  // Every primitive of the character, in world space at rest.
  const parts = [];
  for (const node of gen.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) parts.push({ prim, M });
  }
  const all = [];
  for (const { prim, M } of parts) {
    const P = prim.getAttribute('POSITION');
    for (let i = 0; i < P.getCount(); i++) all.push(...apply(M, ...P.getElement(i, [])));
  }
  // Fit: the character to the mannequin's height, feet on the ground, centred.
  const rb = bounds(R.pts);
  const gb = bounds(all);
  const sy = (rb.max[1] - rb.min[1]) / (gb.max[1] - gb.min[1]);
  const cx = (gb.min[0] + gb.max[0]) / 2;
  const cz = (gb.min[2] + gb.max[2]) / 2;
  const rcx = (rb.min[0] + rb.max[0]) / 2;
  const rcz = (rb.min[2] + rb.max[2]) / 2;
  const fit = (p) => [(p[0] - cx) * sy + rcx, (p[1] - gb.min[1]) * sy + rb.min[1], (p[2] - cz) * sy + rcz];
  // Then the mannequin to the character's arms: beyond the shoulders, stretch along the span.
  const shoulder = R.joints.find((j) => j.getName() === 'upperarm_l');
  const x0 = Math.abs((shoulder ? shoulder.getWorldTranslation() : [0.19])[0] - rcx);
  const k = Math.min(1.4, Math.max(0.6, ((gb.max[0] - gb.min[0]) * sy * 0.5 - x0) / ((rb.max[0] - rb.min[0]) * 0.5 - x0)));
  const warp = (x) => {
    const d = x - rcx;
    return Math.abs(d) <= x0 ? x : rcx + Math.sign(d) * (x0 + (Math.abs(d) - x0) * k);
  };
  for (let i = 0; i < R.pts.length; i += 3) R.pts[i] = warp(R.pts[i]);
  log(`  fit: height x${sy.toFixed(3)}, arms x${k.toFixed(3)}`);
  const world = new Map(R.joints.map((j) => {
    const m = j.getWorldMatrix().slice();
    m[12] = warp(m[12]);
    return [j, m];
  }));
  for (const j of R.joints) {
    const parent = j.getParentNode();
    const pw = parent ? (world.get(parent) ?? parent.getWorldMatrix()) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = world.get(j);
    j.setTranslation(apply(invert(pw), m[12], m[13], m[14]));
  }
  const near = grid(R.pts, 0.05);
  const buffer = ref.getRoot().listBuffers()[0];
  // Merge the character's resources (materials, textures) into the reference document.
  const mapping = mergeDocuments(ref, gen);
  const target = ref.getRoot().listNodes().find((n) => n.getSkin() === R.skin && n.getMesh());
  const body = target.getMesh();
  for (const p of body.listPrimitives()) body.removePrimitive(p);
  let verts = 0;
  for (const { prim: src, M } of parts) {
    const prim = mapping.get(src);
    const P = prim.getAttribute('POSITION');
    const N = prim.getAttribute('NORMAL');
    const n = P.getCount();
    const pos = new Float32Array(n * 3);
    const nor = N ? new Float32Array(n * 3) : null;
    const joints = new Uint8Array(n * 4);
    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = fit(apply(M, ...P.getElement(i, [])));
      pos.set(p, i * 3);
      if (nor) {
        const q = N.getElement(i, []);
        const t = apply(M, q[0], q[1], q[2], 0);
        const l = Math.hypot(...t) || 1;
        nor.set([t[0] / l, t[1] / l, t[2] / l], i * 3);
      }
      // Inverse-square blend of the nearest reference points' weights; keep the four strongest bones.
      const acc = new Map();
      for (const [j, d2] of near(p[0], p[1], p[2], 6)) {
        const f = 1 / (d2 + 1e-6);
        const [jj, ww] = R.jw[j];
        for (let k = 0; k < 4; k++) if (ww[k] > 0) acc.set(jj[k], (acc.get(jj[k]) ?? 0) + ww[k] * f);
      }
      const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = top.reduce((s, [, w]) => s + w, 0) || 1;
      top.forEach(([j, w], k) => {
        joints[i * 4 + k] = j;
        weights[i * 4 + k] = w / tot;
      });
    }
    verts += n;
    prim.setAttribute('POSITION', ref.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer));
    if (nor) prim.setAttribute('NORMAL', ref.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer));
    prim.setAttribute('JOINTS_0', ref.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
    prim.setAttribute('WEIGHTS_0', ref.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
    body.addPrimitive(prim);
  }
  // Positions are in world space at rest, so each inverse bind matrix is its (refitted) joint's world inverse.
  const ibm = new Float32Array(R.joints.length * 16);
  R.joints.forEach((j, i) => ibm.set(invert(j.getWorldMatrix()), i * 16));
  R.skin.setInverseBindMatrices(ref.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  // Drop everything the character brought besides its materials: its nodes, scenes and skins.
  const keep = new Set(ref.getRoot().listScenes().slice(0, 1));
  for (const s of ref.getRoot().listScenes()) if (!keep.has(s)) s.dispose();
  for (const src of gen.getRoot().listNodes()) mapping.get(src)?.dispose();
  for (const src of gen.getRoot().listSkins()) mapping.get(src)?.dispose();
  log(`  bound ${verts} vertices to ${R.joints.length} joints`);
  return ref;
}
