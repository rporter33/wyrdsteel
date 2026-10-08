import * as THREE from 'three';

/**
 * Falling snow around the camera focus. Light in the Iron Wood, a white-out during a blizzard
 * surge; drifting motes in a Well of Wyrd. One Points draw call.
 */
export class Weather {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private readonly N = 900;
  private mode: 'none' | 'snow' | 'motes' | 'embers' = 'none';
  intensity = 0.3;

  constructor() {
    this.pos = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 40;
      this.pos[i * 3 + 1] = Math.random() * 14;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * 34;
      this.vel[i] = 1 + Math.random() * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  setMode(m: 'none' | 'snow' | 'motes' | 'embers'): void {
    this.mode = m;
    this.points.visible = m !== 'none';
    const mat = this.points.material as THREE.PointsMaterial;
    mat.color.setHex(m === 'motes' ? 0xc8b0ff : m === 'embers' ? 0xffa050 : 0xffffff);
    mat.size = m === 'snow' ? 0.12 : 0.09;
  }

  update(dt: number, cx: number, cz: number, wind: number): void {
    if (this.mode === 'none') return;
    const count = Math.floor(this.N * Math.min(1, this.intensity));
    (this.points.geometry as THREE.BufferGeometry).setDrawRange(0, count);
    const up = this.mode === 'embers' ? -1 : this.mode === 'motes' ? -0.15 : 1;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      this.pos[k + 1]! -= this.vel[i]! * dt * up * (this.mode === 'snow' ? 1 + wind * 2 : 0.4);
      this.pos[k]! += (wind * 9 + Math.sin(i + this.pos[k + 1]!) * 0.3) * dt;
      // Wrap around the focus so the volume follows the camera.
      let x = this.pos[k]! - cx;
      let z = this.pos[k + 2]! - cz;
      if (x > 20) x -= 40;
      if (x < -20) x += 40;
      if (z > 17) z -= 34;
      if (z < -17) z += 34;
      this.pos[k] = cx + x;
      this.pos[k + 2] = cz + z;
      if (this.pos[k + 1]! < 0) this.pos[k + 1] = 14;
      if (this.pos[k + 1]! > 14) this.pos[k + 1] = 0;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
