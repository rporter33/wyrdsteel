import * as THREE from 'three';
import type { ContentDb } from '../core/data/types';
import type { SimEvent, World } from '../core/sim/types';
import { createRenderer } from './renderer';
import { CameraRig } from './camera';
import { RoomMesh, PALETTES, type LightSpot } from './level/roomMesh';
import { EntityViews } from './views/entities';
import { Effects } from './fx/effects';
import { FeatureViews } from './views/features';
import { Valkyrie } from './fx/valkyrie';
import { Weather } from './fx/weather';
import { Post } from './post';
import { QUALITY, autoQuality, type Quality, type QualityName } from './quality';
import { setAnisotropy, sky } from './assets';
import { loadCharacters } from './models/characters';

/** Per-zone light: the key light's colour, strength and angle, sky light, fog and exposure. */
interface ZoneLight {
  sun: number;
  sunI: number;
  sunDir: [number, number, number];
  sky: number;
  ground: number;
  hemiI: number;
  env: number;
  exposure: number;
  fogDensity: number;
}

const LIGHTS: Record<string, ZoneLight> = {
  hall: { sun: 0xffe2c0, sunI: 2.4, sunDir: [-0.5, 1, 0.45], sky: 0xdfeeff, ground: 0x2a3644, hemiI: 0.45, env: 0.7, exposure: 1.0, fogDensity: 0.016 },
  wood: { sun: 0xe6efff, sunI: 1.7, sunDir: [-0.35, 1, 0.6], sky: 0xe4f0ff, ground: 0x52606e, hemiI: 0.3, env: 0.55, exposure: 0.8, fogDensity: 0.02 },
  foundry: { sun: 0xffb27a, sunI: 2.2, sunDir: [0.4, 1, 0.5], sky: 0xffd9b0, ground: 0x3a2618, hemiI: 0.4, env: 0.8, exposure: 1.0, fogDensity: 0.026 },
  roots: { sun: 0xa8dcff, sunI: 2.0, sunDir: [-0.3, 1, 0.55], sky: 0xc9ecff, ground: 0x22394a, hemiI: 0.45, env: 0.9, exposure: 1.05, fogDensity: 0.024 },
  wyrd: { sun: 0xc8b0ff, sunI: 1.6, sunDir: [0.3, 1, 0.5], sky: 0xd8c8ff, ground: 0x2a1f44, hemiI: 0.4, env: 0.6, exposure: 1.0, fogDensity: 0.026 },
};

export interface RenderOptions {
  lowFx: boolean;
  shake: number;
  flash: boolean;
  /** Accessibility: thicker, more opaque telegraphs. */
  boldTelegraphs: boolean;
}

/** Everything the player sees in the 3D view. Reads the world; never writes it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly views: EntityViews;
  readonly fx: Effects;
  readonly features: FeatureViews;
  readonly valkyrie: Valkyrie;
  readonly weather = new Weather();
  private frost: HTMLDivElement;
  private room: RoomMesh | null = null;
  private roomKey = '';
  private hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a222c, 0.5);
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private sunDir = new THREE.Vector3(-0.5, 1, 0.45).normalize();
  private post: Post;
  private palette = '';
  /** The few point lights, moved each frame to the light sources nearest the player. */
  private points: THREE.PointLight[] = [];
  private spots: LightSpot[] = [];
  private clock = 0;
  quality: Quality = QUALITY.medium;
  opts: RenderOptions = { lowFx: false, shake: 1, flash: true, boldTelegraphs: false };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly db: ContentDb,
  ) {
    this.renderer = createRenderer(canvas, (w, h) => this.post?.setSize(w, h));
    this.post = new Post(this.renderer, this.scene, this.rig.camera);
    // Count draw calls across the whole frame (the post chain renders several times).
    this.renderer.info.autoReset = false;
    this.views = new EntityViews(db);
    this.fx = new Effects(this.scene, this.rig);
    this.features = new FeatureViews();
    this.valkyrie = new Valkyrie(document.getElementById('hud') ?? document.body);
    this.sun.position.set(-6, 14, 8);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun.target);
    this.views.group.name = 'entities';
    this.features.group.name = 'features';
    this.valkyrie.root.name = 'valkyrie';
    this.weather.points.name = 'weather';
    this.scene.add(this.hemi, this.sun, this.views.group, this.features.group, this.valkyrie.root, this.weather.points);
    this.frost = document.createElement('div');
    this.frost.className = 'frost';
    document.getElementById('hud')?.appendChild(this.frost);
    this.scene.fog = new THREE.FogExp2(0x0b1016, 0.02);
    this.setQuality('auto');
  }

  /** Apply a quality preset ('auto' guesses from the GPU). Rebuilds the post chain and the room. */
  setQuality(name: QualityName | 'auto'): void {
    const q = QUALITY[name === 'auto' ? autoQuality(this.renderer) : name];
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(size.x, size.y, false);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows > 0) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    setAnisotropy(q.anisotropy);
    this.views.realShadows = q.shadows > 0;
    this.views.skinned = this.features.skinned = q.skinned;
    // Rebuild the characters once their models arrive; until then the rigid ones stand in.
    if (q.skinned) void loadCharacters().then((a) => a && this.quality === q && this.invalidate());
    // A fixed number of lights, so moving them never recompiles a shader.
    for (const l of this.points) this.scene.remove(l);
    this.points = Array.from({ length: q.lights }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 9, 2);
      this.scene.add(l);
      return l;
    });
    this.post.configure(q);
    // Relight on the next room build (the sky is loaded or dropped with the preset).
    this.palette = '';
    this.invalidate();
  }

  private floorVer = 0;
  private ensureRoom(w: World, palette: string): void {
    // Cracked ice changes tiles: rebuild the floor only, not the entities or features.
    if (this.room && w.room.ver !== this.floorVer && this.roomKey.startsWith(`${w.room.id}:${w.room.variant}:`)) {
      this.floorVer = w.room.ver;
      this.scene.remove(this.room.group);
      this.room.dispose();
      this.room = new RoomMesh(w.room, PALETTES[palette] ?? PALETTES.hall!, this.quality.textures);
      this.scene.add(this.room.group);
    }
    const key = `${w.room.id}:${w.room.variant}:${w.zone.node}:${w.tick === 0 ? 0 : ''}${this.roomKeyNonce}`;
    if (key === this.roomKey) return;
    this.roomKey = key;
    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
    }
    const pal = PALETTES[palette] ?? PALETTES.hall!;
    this.floorVer = w.room.ver;
    this.room = new RoomMesh(w.room, pal, this.quality.textures);
    this.scene.add(this.room.group);
    this.applyLight(palette, pal.fog);
    this.views.clear();
    this.features.build(w);
    this.weather.setMode(palette === 'wood' ? 'snow' : palette === 'wyrd' ? 'motes' : palette === 'foundry' ? 'embers' : 'none');
    this.fx.clear();
  }
  private applyLight(palette: string, fog: number): void {
    const L = LIGHTS[palette] ?? LIGHTS.hall!;
    this.scene.fog = new THREE.FogExp2(fog, L.fogDensity);
    this.renderer.setClearColor(fog, 1);
    this.renderer.toneMappingExposure = L.exposure;
    this.hemi.color.setHex(L.sky);
    this.hemi.groundColor.setHex(L.ground);
    this.hemi.intensity = L.hemiI;
    this.sun.color.setHex(L.sun);
    this.sun.intensity = L.sunI;
    this.sunDir.set(...L.sunDir).normalize();
    this.scene.environmentIntensity = L.env;
    if (palette !== this.palette) {
      this.palette = palette;
      this.scene.environment = null;
      const key = LIGHTS[palette] ? palette : 'hall';
      if (this.quality.ibl)
        void sky(this.renderer, key).then((env) => {
          if (this.palette === palette && this.quality.ibl) this.scene.environment = env;
        });
    }
  }

  private roomKeyNonce = 0;
  /** Force a rebuild on the next frame (new game, room transition). */
  invalidate(): void {
    this.roomKeyNonce++;
  }

  frame(w: World, alpha: number, dtMs: number, events: SimEvent[], focusSlot: number, palette: string): void {
    this.renderer.info.reset();
    this.ensureRoom(w, palette);
    const dt = dtMs / 1000;
    this.views.camera = this.rig.camera;
    this.views.flash = this.opts.flash;
    this.views.sync(w, alpha, dt);
    this.features.sync(w, dt);
    const p = w.players[focusSlot];
    const e = p ? w.entities.find((x) => x.id === p.entity) : null;
    if (e) {
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      const inp = p!.lastInput;
      // Lead toward the aim point, up to 2 m.
      let lx = 0;
      let lz = 0;
      if (inp.ax || inp.az) {
        const l = Math.hypot(inp.ax, inp.az) / 16;
        const k = Math.min(2, l * 0.25) / Math.max(1e-6, l);
        lx = (inp.ax / 16) * k;
        lz = (inp.az / 16) * k;
      }
      this.rig.settings.shake = this.opts.shake;
      // A giant needs room on screen: pull back while a boss stands.
      this.rig.zoomTarget = w.entities.some((b) => b.boss && !b.dead) ? 1.45 : 1;
      this.rig.update({ x, z }, { x: lx, z: lz }, dt, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
      this.room?.cutaway(x, z, this.rig.camera.position.y, this.rig.camera.position.z);
      this.placeLights(w, x, z, dt);
      // The key light rides with the camera so its shadow map covers what is on screen.
      const reach = 16 * this.rig.zoomTarget;
      const cam = this.sun.shadow.camera;
      if (cam.right !== reach) {
        cam.left = cam.bottom = -reach;
        cam.right = cam.top = reach;
        cam.updateProjectionMatrix();
      }
      this.sun.target.position.set(x, 0, z);
      this.sun.position.set(x + this.sunDir.x * 30, this.sunDir.y * 30, z + this.sunDir.z * 30);
      this.valkyrie.update(e.dead, x, z, dt);
      const surging = w.room.surgeEnd > w.tick;
      const warn = w.room.surgeAt > 0 && w.room.surgeAt - w.tick < 180 && w.room.surgeAt > w.tick;
      this.weather.intensity = surging ? 1 : warn ? 0.6 : 0.3;
      this.weather.update(dt, x, z, surging ? 1 : 0.1);
      const chill = e.status.chill > 0 || e.status.freeze > 0 ? 1 : Math.min(1, e.status.b[1]! / 100);
      this.frost.style.opacity = String(surging ? 0.25 + chill * 0.6 : chill * 0.6);
    }
    this.fx.update(w, events, dt, this.opts, (id) => this.views.get(id), (id, b, t) => this.views.blade(id, b, t), this.db);
    this.post.render();
  }

  /** Put the point lights on the light sources nearest the player; the rest stay dark. */
  private placeLights(w: World, x: number, z: number, dt: number): void {
    if (!this.points.length) return;
    this.clock += dt;
    this.spots.length = 0;
    if (this.room) for (const s of this.room.lights) this.spots.push(s);
    this.features.lightSpots(w, this.spots);
    const d = (s: LightSpot) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    this.spots.sort((a, b) => d(a) - d(b));
    this.points.forEach((l, i) => {
      const s = this.spots[i];
      if (!s) {
        l.intensity = 0;
        return;
      }
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      const t = this.clock * 11 + s.x * 3.1 + s.z * 1.7;
      l.intensity = s.intensity * (1 + s.flicker * (Math.sin(t) * 0.6 + Math.sin(t * 2.7) * 0.4));
    });
  }

  info(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}
