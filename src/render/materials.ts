import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();

/** Colours that read as metal on the procedural models: shiny and reflective rather than matte. */
const METALS = new Set<number>([0x8fb4d6, 0x3f5468, 0xf5c542, 0x2a3038, 0x8a8f95, 0x4d5862, 0xa9b8c4]);

export interface SurfaceOpts {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  metal?: number;
  rough?: number;
  key?: string;
}

/**
 * A physically based surface for procedural geometry: lit by the zone's sky and lights. Metals
 * in the palette come out polished; everything else rough. Cached per colour and options.
 */
export function surface(color: THREE.ColorRepresentation, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
  const hex = new THREE.Color(color).getHex();
  const metal = opts.metal ?? (METALS.has(hex) ? 0.85 : 0.05);
  const rough = opts.rough ?? (METALS.has(hex) ? 0.35 : 0.7);
  const key = opts.key ?? `${hex}|${opts.emissive ? new THREE.Color(opts.emissive).getHex() : ''}|${opts.emissiveIntensity ?? 0}|${metal}|${rough}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    cache.set(key, m);
  }
  return m;
}

/** Glowing parts (runes, hearts, muzzles) draw unlit; everything else is lit. */
export function isGlowing(mat: THREE.Material): boolean {
  if (mat instanceof THREE.MeshBasicMaterial) return true;
  const m = mat as THREE.MeshStandardMaterial;
  return !!m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 0) > 0;
}

/** Vertex-coloured physically based surface (crowd bodies, merged props). */
export function surfaceVertex(): THREE.MeshStandardMaterial {
  const key = '__vertex';
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.2, roughness: 0.6 });
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
