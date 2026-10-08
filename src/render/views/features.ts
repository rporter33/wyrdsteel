import * as THREE from 'three';
import type { World } from '../../core/sim/types';

/** Braziers, vents, waystones and other room features. Filled in with the zones milestone. */
export class FeatureViews {
  readonly group = new THREE.Group();
  build(_w: World): void {
    this.group.clear();
  }
  sync(_w: World, _dt: number): void {}
}
