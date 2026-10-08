import * as THREE from 'three';
import { T_CRACKED, T_FLOOR, T_ICE, T_LOW, T_PIT, T_VOID, T_WALL } from '../../core/level/grid';
import type { RoomState } from '../../core/sim/types';
import { toon, toonVertex } from '../materials';

export interface RoomPalette {
  floor: number;
  floorAlt: number;
  wall: number;
  wallTop: number;
  low: number;
  ice: number;
  pit: number;
  fog: number;
  light: number;
  ambient: number;
}

export const PALETTES: Record<string, RoomPalette> = {
  hall: { floor: 0x3a434d, floorAlt: 0x333b44, wall: 0x59636e, wallTop: 0x8a96a3, low: 0x4b5560, ice: 0xa8d8f0, pit: 0x05080c, fog: 0x0b1016, light: 0xdfeeff, ambient: 0x2a3644 },
  wood: { floor: 0xbfcad3, floorAlt: 0xaebbc6, wall: 0x2b2522, wallTop: 0x4a3f38, low: 0x3d3632, ice: 0xa8d8f0, pit: 0x05080c, fog: 0x8796a3, light: 0xe4f0ff, ambient: 0x52606e },
  foundry: { floor: 0x3b3430, floorAlt: 0x342e2b, wall: 0x5b4636, wallTop: 0x8a5a36, low: 0x6b5242, ice: 0xa8d8f0, pit: 0x1a0700, fog: 0x1a120d, light: 0xffd9b0, ambient: 0x3a2618 },
  roots: { floor: 0x5e7486, floorAlt: 0x566a7b, wall: 0x2e3d4a, wallTop: 0x4c6577, low: 0x3b4e5c, ice: 0xbfe8fb, pit: 0x041422, fog: 0x0d1b26, light: 0xc9ecff, ambient: 0x22394a },
};

const WALL_H = 2.6;

/** Static room geometry: one merged floor, instanced walls. Walls nearest the camera cut away. */
export class RoomMesh {
  readonly group = new THREE.Group();
  private walls: THREE.InstancedMesh | null = null;
  private wallPos: { x: number; z: number; h: number }[] = [];
  private lastCut = '';
  private readonly m = new THREE.Matrix4();

  constructor(
    readonly room: RoomState,
    readonly palette: RoomPalette,
  ) {
    this.build();
  }

  private build(): void {
    const { w, h, tiles } = this.room;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const pushQuad = (x: number, z: number, y: number, color: THREE.Color) => {
      const b = pos.length / 3;
      pos.push(x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1);
      for (let i = 0; i < 4; i++) col.push(color.r, color.g, color.b);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    const walls: { x: number; z: number; h: number }[] = [];
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[z * w + x]!;
        // Hash-based variation so floors read as tiles without a texture.
        const n = ((x * 73856093) ^ (z * 19349663)) & 7;
        if (t === T_FLOOR) {
          // Mostly one tone, with every few tiles slightly darker: reads as flagstones, not a checkerboard.
          c.setHex(n === 0 || n === 5 ? this.palette.floorAlt : this.palette.floor).offsetHSL(0, 0, (n - 3.5) * 0.0015);
          pushQuad(x, z, 0, c);
        } else if (t === T_ICE || t === T_CRACKED) {
          c.setHex(this.palette.ice).offsetHSL(0, 0, t === T_CRACKED ? -0.18 : (n - 3.5) * 0.006);
          pushQuad(x, z, 0, c);
        } else if (t === T_PIT) {
          c.setHex(this.palette.pit);
          pushQuad(x, z, -0.6, c);
        } else if (t === T_WALL) {
          walls.push({ x, z, h: WALL_H + (n % 3) * 0.15 });
        } else if (t === T_LOW) {
          walls.push({ x, z, h: 0.9 });
        } else if (t === T_VOID) {
          // Only draw void tiles that border the room, as a dark rim.
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const floor = new THREE.Mesh(g, toonVertex());
    floor.receiveShadow = false;
    this.group.add(floor);

    if (walls.length) {
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0.5, 0.5, 0.5);
      const mesh = new THREE.InstancedMesh(box, toon(0xffffff, { key: 'wall-white' }), walls.length);
      walls.forEach((wl, i) => {
        this.m.makeScale(1, wl.h, 1).setPosition(wl.x, 0, wl.z);
        mesh.setMatrixAt(i, this.m);
        const shade = wl.h < 1 ? this.palette.low : this.palette.wall;
        c.setHex(shade).offsetHSL(0, 0, ((((wl.x * 31) ^ (wl.z * 17)) & 7) - 3.5) * 0.01);
        mesh.setColorAt(i, c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.walls = mesh;
      this.wallPos = walls;
      this.group.add(mesh);
    }
  }

  /** Lower walls between the camera (south) and the player so the player is never hidden. */
  cutaway(px: number, pz: number): void {
    if (!this.walls) return;
    const key = `${Math.floor(px)}:${Math.floor(pz)}`;
    if (key === this.lastCut) return;
    this.lastCut = key;
    this.wallPos.forEach((wl, i) => {
      const dz = wl.z - pz;
      const dx = Math.abs(wl.x + 0.5 - px);
      const cut = dz > -0.5 && dz < 6 && dx < 5 - dz * 0.3;
      const hh = cut ? Math.min(wl.h, 0.45) : wl.h;
      this.m.makeScale(1, hh, 1).setPosition(wl.x, 0, wl.z);
      this.walls!.setMatrixAt(i, this.m);
    });
    this.walls.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
