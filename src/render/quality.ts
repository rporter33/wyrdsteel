import type * as THREE from 'three';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

/** What each preset turns on. Low is the old laptop budget; High is the target look. */
export interface Quality {
  name: QualityName;
  /** Cap on device pixel ratio. */
  dpr: number;
  /** Shadow map size; 0 = blob shadows only. */
  shadows: number;
  /** Ground-truth ambient occlusion. */
  ao: boolean;
  bloom: boolean;
  /** Anti-aliasing after post (SMAA) or the browser's MSAA when there is no post chain. */
  smaa: boolean;
  /** Physically based texture sets on rooms and props (otherwise flat colour). */
  textures: boolean;
  anisotropy: number;
  /** Dynamic point lights from braziers, vents and glows. */
  lights: number;
  /** Image-based light from the zone's sky (reflections and fill); off, the hemisphere light fills alone. */
  ibl: boolean;
  /** Skinned, clip-animated characters (a download of about 2 MB) rather than rigid procedural ones. */
  skinned: boolean;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', dpr: 1, shadows: 0, ao: false, bloom: false, smaa: false, textures: false, anisotropy: 1, lights: 0, ibl: false, skinned: false },
  medium: { name: 'medium', dpr: 1, shadows: 1024, ao: false, bloom: true, smaa: true, textures: true, anisotropy: 4, lights: 2, ibl: true, skinned: true },
  high: { name: 'high', dpr: 1.5, shadows: 2048, ao: true, bloom: true, smaa: true, textures: true, anisotropy: 8, lights: 4, ibl: true, skinned: true },
  ultra: { name: 'ultra', dpr: 2, shadows: 4096, ao: true, bloom: true, smaa: true, textures: true, anisotropy: 16, lights: 6, ibl: true, skinned: true },
};

/**
 * A first guess from the GPU's name; the player can override it in Settings. Software renderers
 * (the test browsers) get Low; integrated Intel graphics Medium; Apple silicon and discrete
 * GPUs High.
 */
export function autoQuality(renderer: THREE.WebGLRenderer): QualityName {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
  if (/apple m\d|nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc a/.test(name)) return 'high';
  if (/intel|mali|adreno|powervr|apple gpu/.test(name)) return 'medium';
  return 'medium';
}
