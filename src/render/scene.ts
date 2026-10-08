import * as THREE from 'three';
import type { ContentDb } from '../core/data/types';
import type { SimEvent, World } from '../core/sim/types';
import { createRenderer } from './renderer';
import { CameraRig } from './camera';
import { RoomMesh, PALETTES } from './level/roomMesh';
import { EntityViews } from './views/entities';
import { Effects } from './fx/effects';
import { FeatureViews } from './views/features';
import { Valkyrie } from './fx/valkyrie';
import { Weather } from './fx/weather';

export interface RenderOptions {
  lowFx: boolean;
  shake: number;
  flash: boolean;
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
  private hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a222c, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 1.4);
  opts: RenderOptions = { lowFx: false, shake: 1, flash: true };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly db: ContentDb,
  ) {
    this.renderer = createRenderer(canvas);
    this.views = new EntityViews(db);
    this.fx = new Effects(this.scene, this.rig);
    this.features = new FeatureViews();
    this.valkyrie = new Valkyrie(document.getElementById('hud') ?? document.body);
    this.sun.position.set(-6, 14, 8);
    this.views.group.name = 'entities';
    this.features.group.name = 'features';
    this.valkyrie.root.name = 'valkyrie';
    this.weather.points.name = 'weather';
    this.scene.add(this.hemi, this.sun, this.views.group, this.features.group, this.valkyrie.root, this.weather.points);
    this.frost = document.createElement('div');
    this.frost.className = 'frost';
    document.getElementById('hud')?.appendChild(this.frost);
    this.scene.fog = new THREE.Fog(0x0b1016, 26, 60);
  }

  private floorVer = 0;
  private ensureRoom(w: World, palette: string): void {
    // Cracked ice changes tiles: rebuild the floor only, not the entities or features.
    if (this.room && w.room.ver !== this.floorVer && this.roomKey.startsWith(`${w.room.id}:${w.room.variant}:`)) {
      this.floorVer = w.room.ver;
      this.scene.remove(this.room.group);
      this.room.dispose();
      this.room = new RoomMesh(w.room, PALETTES[palette] ?? PALETTES.hall!);
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
    this.room = new RoomMesh(w.room, pal);
    this.scene.add(this.room.group);
    this.scene.fog = new THREE.Fog(pal.fog, 24, 56);
    this.renderer.setClearColor(pal.fog, 1);
    this.hemi.color.setHex(pal.light);
    this.hemi.groundColor.setHex(pal.ambient);
    this.views.clear();
    this.features.build(w);
    this.weather.setMode(palette === 'wood' ? 'snow' : palette === 'wyrd' ? 'motes' : palette === 'foundry' ? 'embers' : 'none');
    this.fx.clear();
  }
  private roomKeyNonce = 0;
  /** Force a rebuild on the next frame (new game, room transition). */
  invalidate(): void {
    this.roomKeyNonce++;
  }

  frame(w: World, alpha: number, dtMs: number, events: SimEvent[], focusSlot: number, palette: string): void {
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
      this.room?.cutaway(x, z);
      this.valkyrie.update(e.dead, x, z, dt);
      const surging = w.room.surgeEnd > w.tick;
      const warn = w.room.surgeAt > 0 && w.room.surgeAt - w.tick < 180 && w.room.surgeAt > w.tick;
      this.weather.intensity = surging ? 1 : warn ? 0.6 : 0.3;
      this.weather.update(dt, x, z, surging ? 1 : 0.1);
      const chill = e.status.chill > 0 || e.status.freeze > 0 ? 1 : Math.min(1, e.status.b[1]! / 100);
      this.frost.style.opacity = String(surging ? 0.25 + chill * 0.6 : chill * 0.6);
    }
    this.fx.update(w, events, dt, this.opts, (id) => this.views.get(id));
    this.renderer.render(this.scene, this.rig.camera);
  }

  info(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}
