import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from './quality';

/**
 * The frame after the scene is drawn: ambient occlusion in creases and under bodies, bloom on
 * anything brighter than white (runes, forge hearts, embers), filmic tone mapping, then SMAA.
 * Low quality skips the chain and draws straight to the screen; the passes load on demand, so
 * they are not part of the title screen's download.
 */
export class Post {
  private composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  private version = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  configure(q: Quality): void {
    const v = ++this.version;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!q.ao && !q.bloom && !q.smaa) return;
    void Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/GTAOPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
      import('three/examples/jsm/postprocessing/SMAAPass.js'),
    ]).then(([{ EffectComposer }, { RenderPass }, { GTAOPass }, { UnrealBloomPass }, { OutputPass }, { SMAAPass }]) => {
      if (v !== this.version) return;
      this.build(q, { EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, SMAAPass });
    });
  }

  private build(q: Quality, P: typeof import('./postPasses')): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const composer = new P.EffectComposer(this.renderer);
    composer.addPass(new P.RenderPass(this.scene, this.camera));
    if (q.ao) {
      const gtao = new P.GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 2, scale: 1.1, samples: 12 });
      gtao.blendIntensity = 0.85;
      composer.addPass(gtao);
    }
    if (q.bloom) {
      // Threshold above white: only emissive light (runes, hearts, embers, lava) blooms, not lit snow.
      this.bloom = new P.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.4, 1.6);
      composer.addPass(this.bloom);
    }
    composer.addPass(new P.OutputPass());
    if (q.smaa) composer.addPass(new P.SMAAPass());
    this.composer = composer;
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
