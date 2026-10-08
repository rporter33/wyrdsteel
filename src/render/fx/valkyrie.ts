import * as THREE from 'three';
import { buildHumanoid } from '../models/humanoid';
import { glow } from '../models/kit';
import { PALETTE } from '../materials';

/**
 * The Valkyrie: she descends over the fallen player, and the screen dims. 2.5 s at most, and any
 * button skips it after 0.3 s (the sim decides; this only draws it).
 */
export class Valkyrie {
  readonly root = new THREE.Group();
  private wings: THREE.Mesh[] = [];
  private t = -1;
  private overlay: HTMLDivElement;

  constructor(host: HTMLElement) {
    const r = buildHumanoid({ body: 0xe8dcc4, trim: 0xf5c542, skin: 0xd9c0a8, eye: 0xffffff, bulk: 0.9, height: 2.2, helm: 'crest', cape: 0xf2ead8, cyber: 0 });
    r.armL.rotation.x = r.armR.rotation.x = -0.8;
    this.root.add(r.root);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), new THREE.MeshBasicMaterial({ color: 0xf8f4ea, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      wing.position.set(side * 1.3, 1.9, -0.25);
      wing.rotation.z = side * 0.35;
      this.wings.push(wing);
      this.root.add(wing);
    }
    const halo = glow(0.06, PALETTE.gold, 2.5);
    halo.scale.set(5, 0.4, 5);
    halo.position.y = 2.45;
    this.root.add(halo);
    this.root.visible = false;
    this.overlay = document.createElement('div');
    this.overlay.className = 'valk-overlay';
    this.overlay.innerHTML = '<div class="valk-text">The Valkyrie bears you to the waystone</div><div class="valk-hint">Press any button</div>';
    host.appendChild(this.overlay);
  }

  /** Called every frame with whether the local player is down and where. */
  update(down: boolean, x: number, z: number, dt: number): void {
    if (down) {
      if (this.t < 0) this.t = 0;
      this.t += dt;
    } else if (this.t >= 0) {
      this.t = -1;
    }
    const on = this.t >= 0;
    this.root.visible = on;
    this.overlay.classList.toggle('on', on);
    if (!on) return;
    const k = Math.min(1, this.t / 1.4);
    this.root.position.set(x, 9 - 7.2 * (1 - (1 - k) * (1 - k)), z - 0.5);
    for (const [i, wing] of this.wings.entries()) wing.rotation.y = Math.sin(this.t * 6 + i) * 0.4;
    this.overlay.style.setProperty('--valk', String(Math.min(1, this.t / 0.8)));
  }
}
