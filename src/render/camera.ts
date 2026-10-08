import * as THREE from 'three';

export interface CameraSettings {
  distance: number;
  pitchDeg: number;
  shake: number;
}

/**
 * Fixed 3/4 overhead camera. It follows with a critically damped spring and leads toward the aim,
 * and never rotates or recentres on its own, so it can never take control away from the player.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
  settings: CameraSettings = { distance: 18, pitchDeg: 55, shake: 1 };
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private trauma = 0;
  private t = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2);
  private readonly hit = new THREE.Vector3();
  private snapped = false;
  /** Multiplier on the player's chosen distance, eased: a boss fight pulls the camera back. */
  zoomTarget = 1;
  private zoom = 1;

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  snap(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.snapped = true;
  }

  update(target: { x: number; z: number }, lead: { x: number; z: number }, dt: number, aspect: number): void {
    const want = new THREE.Vector3(target.x + lead.x, 0, target.z + lead.z);
    if (!this.snapped) this.snap(want.x, want.z);
    // Critically damped spring, omega ~ 9/s: responsive without jitter.
    const omega = 9;
    const s = Math.min(dt, 0.05);
    const diff = this.pos.clone().sub(want);
    const acc = diff.multiplyScalar(-omega * omega).sub(this.vel.clone().multiplyScalar(2 * omega));
    this.vel.addScaledVector(acc, s);
    this.pos.addScaledVector(this.vel, s);
    const pitch = THREE.MathUtils.degToRad(this.settings.pitchDeg);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, s * 1.5);
    const d = this.settings.distance * this.zoom;
    this.camera.position.set(this.pos.x, Math.sin(pitch) * d, this.pos.z + Math.cos(pitch) * d);
    this.t += s;
    this.trauma = Math.max(0, this.trauma - s * 1.6);
    const shake = this.trauma * this.trauma * this.settings.shake;
    if (shake > 0) {
      this.camera.position.x += Math.sin(this.t * 61) * 0.35 * shake;
      this.camera.position.y += Math.sin(this.t * 53 + 1.3) * 0.25 * shake;
    }
    this.camera.lookAt(this.pos.x, 0.8, this.pos.z);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** World point at chest height under a canvas-relative pointer position. */
  pointToWorld(ndcX: number, ndcY: number): { x: number; z: number } | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const p = this.ray.ray.intersectPlane(this.plane, this.hit);
    return p ? { x: p.x, z: p.z } : null;
  }

  get focus(): { x: number; z: number } {
    return { x: this.pos.x, z: this.pos.z };
  }
}
