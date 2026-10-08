import * as THREE from 'three';
import { toon, toonVertex as toonVertexMat } from '../materials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Primitive kit for procedural models. Everything is low-poly and flat-shaded through the toon
// ramp; silhouettes come from proportions, not detail.

export function box(w: number, h: number, d: number, color: number, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  return m;
}

export function cyl(rt: number, rb: number, h: number, color: number, seg = 6, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), toon(color));
  m.position.y = y;
  return m;
}

export function cone(r: number, h: number, color: number, seg = 5): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), toon(color));
}

export function ico(r: number, color: number, detail = 0): THREE.Mesh {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), toon(color));
}

export function glow(r: number, color: number, intensity = 2.5): THREE.Mesh {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), toon(color, { emissive: color, emissiveIntensity: intensity }));
}

/** A pivot group: rotate it to swing whatever hangs from it. */
export function pivot(x: number, y: number, z: number, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  for (const c of children) g.add(c);
  return g;
}

let blob: THREE.Mesh | null = null;
/** Soft round shadow under every character; cheaper than shadow maps and reads well from above. */
export function blobShadow(r: number): THREE.Mesh {
  if (!blob) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
  }
  const m = blob.clone();
  m.scale.set(r * 2.6, r * 2.6, 1);
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

/** Meshes that bakeStatic merges: opaque ones not listed as animated. */
export function bakeable(o: THREE.Object3D, skip?: Set<THREE.Object3D>): o is THREE.Mesh {
  return o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent && !skip?.has(o);
}

/**
 * Merge a static model into at most two meshes (lit and glowing) with baked vertex colours.
 * NPCs and props don't animate per limb, so they cost two draw calls instead of twenty-five.
 * Meshes in `skip` (animated parts) are left out; already-baked meshes keep their colours.
 */
export function bakeStatic(root: THREE.Object3D, skip?: Set<THREE.Object3D>): THREE.Group {
  root.updateMatrixWorld(true);
  const lit: THREE.BufferGeometry[] = [];
  const glowG: THREE.BufferGeometry[] = [];
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!bakeable(o, skip)) return;
    const mat = o.material as THREE.MeshToonMaterial;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('color') || !mat.vertexColors) {
      const c = mat.color ?? new THREE.Color(0xffffff);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    ((mat.emissiveIntensity ?? 0) > 0 || mat instanceof THREE.MeshBasicMaterial ? glowG : lit).push(g);
  });
  const out = new THREE.Group();
  if (lit.length) out.add(new THREE.Mesh(mergeGeometries(lit, false)!, toonVertexMat()));
  if (glowG.length) out.add(new THREE.Mesh(mergeGeometries(glowG, false)!, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  return out;
}
