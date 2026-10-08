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
    this.scene.add(this.hemi, this.sun, this.views.group, this.features.group, this.valkyrie.root);
    this.scene.fog = new THREE.Fog(0x0b1016, 26, 60);
  }

  private ensureRoom(w: World, palette: string): void {
    const key = `${w.room.id}:${w.room.variant}:${w.zone.node}:${w.tick === 0 ? 0 : ''}${this.roomKeyNonce}`;
    if (key === this.roomKey) return;
    this.roomKey = key;
    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
    }
    const pal = PALETTES[palette] ?? PALETTES.hall!;
    this.room = new RoomMesh(w.room, pal);
    this.scene.add(this.room.group);
    this.scene.fog = new THREE.Fog(pal.fog, 24, 56);
    this.renderer.setClearColor(pal.fog, 1);
    this.hemi.color.setHex(pal.light);
    this.hemi.groundColor.setHex(pal.ambient);
    this.views.clear();
    this.features.build(w);
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
      this.rig.update({ x, z }, { x: lx, z: lz }, dt, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
      this.room?.cutaway(x, z);
      this.valkyrie.update(e.dead, x, z, dt);
    }
    this.fx.update(w, events, dt, this.opts, (id) => this.views.get(id));
    this.renderer.render(this.scene, this.rig.camera);
  }

  info(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}
