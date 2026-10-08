import * as THREE from 'three';

let ramp: THREE.DataTexture | null = null;

/** Three-step toon ramp generated in code: shadow, mid, lit. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map<string, THREE.Material>();

export function toon(color: THREE.ColorRepresentation, opts: { emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; key?: string } = {}): THREE.MeshToonMaterial {
  const key = opts.key ?? `${new THREE.Color(color).getHexString()}|${opts.emissive ? new THREE.Color(opts.emissive).getHexString() : ''}|${opts.emissiveIntensity ?? 0}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    cache.set(key, m);
  }
  return m;
}

/** Per-instance tinted material for crowds; colour comes from instanceColor or vertex colours. */
export function toonVertex(): THREE.MeshToonMaterial {
  const key = '__vertex';
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
    cache.set(key, m);
  }
  return m;
}

export const PALETTE = {
  steel: 0x8fb4d6,
  steelDark: 0x3f5468,
  gold: 0xf5c542,
  ember: 0xff9a3c,
  frost: 0x9be7ff,
  blood: 0xe5484d,
  bone: 0xe8dcc4,
  iron: 0x2a3038,
  wood: 0x5a4632,
  stone: 0x59636e,
  snow: 0xdfe8ef,
  ice: 0xa8d8f0,
  human: 0x7fe0a0,
  cyber: 0x5ad0ff,
  rune: 0x78c6ff,
};
