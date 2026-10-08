import * as THREE from 'three';
import type { SimEvent, World } from '../../core/sim/types';
import type { CameraRig } from '../camera';
import type { RenderOptions } from '../scene';

/** Particles, damage numbers and telegraph decals. Filled in with the combat milestone. */
export class Effects {
  constructor(
    readonly scene: THREE.Scene,
    readonly rig: CameraRig,
  ) {}
  clear(): void {}
  update(_w: World, _events: SimEvent[], _dt: number, _opts: RenderOptions, _get: (id: number) => THREE.Object3D | null): void {}
}
