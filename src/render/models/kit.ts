import * as THREE from 'three';
import { toon } from '../materials';

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
