import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Art loaded at run time from public/assets (built by scripts/assets/build.mjs from CC0 sources).
 * Textures are returned at once and fill in when their image arrives; models and skies are
 * promises, cached so each file is fetched once.
 */
const BASE = './assets/';

export type MaterialName = 'slabs' | 'masonry' | 'snow' | 'snowsoft' | 'bark' | 'rock' | 'plates' | 'rust' | 'walkway' | 'lava' | 'ice' | 'crystal' | 'dirt';

const textures = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
let anisotropy = 4;

export function setAnisotropy(a: number): void {
  anisotropy = a;
  for (const t of textures.values()) {
    t.anisotropy = a;
    t.needsUpdate = true;
  }
}

function texture(path: string, srgb: boolean): THREE.Texture {
  let t = textures.get(path);
  if (!t) {
    t = loader.load(BASE + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    textures.set(path, t);
  }
  return t;
}

export interface PbrOpts {
  /** Metres covered by one repeat of the texture. */
  scale?: number;
  tint?: THREE.ColorRepresentation;
  emissive?: number;
  envIntensity?: number;
  /** Multipliers on the texture's metalness and roughness. */
  metal?: number;
  rough?: number;
}

/**
 * Per-set corrections. Scanned metal is near-black albedo that only reads under a bright sky;
 * the zones are lit by fire and dim interiors, so the plate sets are taken part-way to painted.
 */
const TUNE: Partial<Record<MaterialName, { metal: number; rough: number }>> = {
  plates: { metal: 0.45, rough: 1.6 },
  rust: { metal: 0.3, rough: 1.3 },
  walkway: { metal: 0.6, rough: 1.2 },
};

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A textured physically based material: colour, normal, and one packed ORM image (ambient
 * occlusion, roughness, metalness). Geometry supplies UVs in metres; `scale` sets the repeat.
 */
export function pbr(name: MaterialName, opts: PbrOpts = {}): THREE.MeshStandardMaterial {
  const tune = TUNE[name];
  const metal = opts.metal ?? tune?.metal ?? 1;
  const rough = opts.rough ?? tune?.rough ?? 1;
  const key = `${name}|${opts.scale ?? 2}|${new THREE.Color(opts.tint ?? 0xffffff).getHex()}|${opts.emissive ?? 0}|${metal}|${rough}`;
  let m = materials.get(key);
  if (m) return m;
  const s = 1 / (opts.scale ?? 2);
  const tex = (file: string, srgb: boolean) => {
    // Clones share the source image, which uploads once it arrives; only the repeat differs.
    const t = texture(`materials/${name}/${file}.webp`, srgb).clone();
    t.repeat.set(s, s);
    return t;
  };
  const orm = tex('orm', false);
  m = new THREE.MeshStandardMaterial({
    map: tex('color', true),
    normalMap: tex('normal', false),
    aoMap: orm,
    roughnessMap: orm,
    metalnessMap: orm,
    color: opts.tint ?? 0xffffff,
    roughness: rough,
    metalness: metal,
  });
  if (opts.emissive) {
    m.emissiveMap = tex('color', true);
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = opts.emissive;
  }
  if (opts.envIntensity !== undefined) m.envMapIntensity = opts.envIntensity;
  materials.set(key, m);
  return m;
}

const skies = new Map<string, Promise<THREE.Texture>>();

/** A zone's sky, prefiltered for image-based lighting. Never drawn; it only lights the scene. */
export function sky(renderer: THREE.WebGLRenderer, zone: string): Promise<THREE.Texture> {
  let p = skies.get(zone);
  if (!p) {
    p = import('three/examples/jsm/loaders/HDRLoader.js').then(({ HDRLoader }) => new HDRLoader().loadAsync(`${BASE}env/${zone}.hdr`)).then((hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pmrem.dispose();
      return env;
    });
    skies.set(zone, p);
  }
  return p;
}

// The glTF loader and meshopt decoder load with the first model, not with the title screen.
let gltfLoader: Promise<{ loadAsync(url: string): Promise<GLTF> }> | null = null;
const models = new Map<string, Promise<GLTF>>();

export function model(file: string): Promise<GLTF> {
  let p = models.get(file);
  if (!p) {
    gltfLoader ??= Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]).then(([{ GLTFLoader }, { MeshoptDecoder }]) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
    );
    p = gltfLoader.then((l) => l.loadAsync(`${BASE}characters/${file}`));
    models.set(file, p);
  }
  return p;
}
