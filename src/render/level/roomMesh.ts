import * as THREE from 'three';
import { T_CRACKED, T_FLOOR, T_ICE, T_LOW, T_PIT, T_VOID, T_WALL } from '../../core/level/grid';
import type { RoomState } from '../../core/sim/types';
import { toon, toonVertex } from '../materials';

export interface RoomPalette {
  /** How wall tiles are drawn. */
  style?: 'blocks' | 'trees' | 'crystal';
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
  wood: { style: 'trees', floor: 0xbfcad3, floorAlt: 0xaebbc6, wall: 0x2b2522, wallTop: 0x4a3f38, low: 0x3d3632, ice: 0xa8d8f0, pit: 0x05080c, fog: 0x8796a3, light: 0xe4f0ff, ambient: 0x52606e },
  foundry: { floor: 0x3b3430, floorAlt: 0x342e2b, wall: 0x5b4636, wallTop: 0x8a5a36, low: 0x6b5242, ice: 0xa8d8f0, pit: 0x1a0700, fog: 0x1a120d, light: 0xffd9b0, ambient: 0x3a2618 },
  wyrd: { style: 'crystal', floor: 0x2a2440, floorAlt: 0x241f38, wall: 0x4a3a6a, wallTop: 0x7a5aaa, low: 0x3a2f55, ice: 0xa8d8f0, pit: 0x05030a, fog: 0x120e1e, light: 0xd8c8ff, ambient: 0x2a1f44 },
  roots: { style: 'crystal', floor: 0x5e7486, floorAlt: 0x566a7b, wall: 0x2e3d4a, wallTop: 0x4c6577, low: 0x3b4e5c, ice: 0xbfe8fb, pit: 0x041422, fog: 0x0d1b26, light: 0xc9ecff, ambient: 0x22394a },
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
          c.setHex(n === 0 || n === 5 ? this.palette.floorAlt : this.palette.floor).multiplyScalar(1 + (n - 3.5) * 0.008);
          pushQuad(x, z, 0, c);
        } else if (t === T_ICE || t === T_CRACKED) {
          c.setHex(this.palette.ice).multiplyScalar(t === T_CRACKED ? 0.6 : 1 + (n - 3.5) * 0.01);
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

    // A ground plane under everything, so the world beyond the walls is snowfield or stone, not void.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w + 60, h + 60), toon(this.palette.floorAlt, { key: `ground-${this.palette.floorAlt}` }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w / 2, -0.02, h / 2);
    this.group.add(ground);

    if (walls.length && this.palette.style === 'trees') {
      this.buildTrees(walls);
    } else if (walls.length) {
      const box = this.palette.style === 'crystal' ? new THREE.CylinderGeometry(0.35, 0.6, 1, 5) : new THREE.BoxGeometry(1, 1, 1);
      if (this.palette.style === 'crystal') box.translate(0.5, 0.5, 0.5);
      else box.translate(0.5, 0.5, 0.5);
      const mesh = new THREE.InstancedMesh(box, toon(0xffffff, { key: 'wall-white' }), walls.length);
      walls.forEach((wl, i) => {
        this.m.makeScale(1, wl.h, 1).setPosition(wl.x, 0, wl.z);
        mesh.setMatrixAt(i, this.m);
        const shade = wl.h < 1 ? this.palette.low : this.palette.wall;
        c.setHex(shade).multiplyScalar(1 + ((((wl.x * 31) ^ (wl.z * 17)) & 7) - 3.5) * 0.02);
        mesh.setColorAt(i, c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.walls = mesh;
      this.wallPos = walls;
      this.group.add(mesh);
    }
  }

  private trunks: THREE.InstancedMesh | null = null;
  private canopies: THREE.InstancedMesh | null = null;

  /** Iron-bark trees for wall tiles: dark trunks with snow-heavy crowns. Fallen logs for low walls. */
  private buildTrees(walls: { x: number; z: number; h: number }[]): void {
    const c = new THREE.Color();
    const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 1, 6).translate(0, 0.5, 0);
    const crownG = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkG, toon(0xffffff, { key: 'wall-white' }), walls.length);
    const crowns = new THREE.InstancedMesh(crownG, toon(0xffffff, { key: 'wall-white' }), walls.length);
    walls.forEach((wl, i) => {
      const n = ((wl.x * 73856093) ^ (wl.z * 19349663)) >>> 0;
      const jx = ((n & 15) / 15 - 0.5) * 0.5;
      const jz = (((n >> 4) & 15) / 15 - 0.5) * 0.5;
      const tall = wl.h < 1 ? 0.6 : 3.4 + ((n >> 8) & 7) * 0.35;
      if (wl.h < 1) {
        // Fallen log.
        this.m.makeRotationZ(Math.PI / 2).scale(new THREE.Vector3(1.3, 1.1, 1.3)).setPosition(wl.x + 0.5 + 0.55, 0.3, wl.z + 0.5);
        trunks.setMatrixAt(i, this.m);
        c.setHex(0x3d3632);
        trunks.setColorAt(i, c);
        this.m.makeScale(0, 0, 0);
        crowns.setMatrixAt(i, this.m);
        crowns.setColorAt(i, c);
        return;
      }
      this.m.makeScale(1, tall, 1).setPosition(wl.x + 0.5 + jx, 0, wl.z + 0.5 + jz);
      trunks.setMatrixAt(i, this.m);
      c.setHex(this.palette.wall).multiplyScalar(0.9 + ((n >> 12) & 3) * 0.05);
      trunks.setColorAt(i, c);
      const r = 0.9 + ((n >> 14) & 3) * 0.15;
      this.m.makeScale(r, 2.2 + ((n >> 16) & 3) * 0.3, r).setPosition(wl.x + 0.5 + jx, tall - 0.6, wl.z + 0.5 + jz);
      crowns.setMatrixAt(i, this.m);
      c.setHex((n >> 18) & 1 ? 0xdfe8ef : 0x2f3a36);
      crowns.setColorAt(i, c);
    });
    for (const m of [trunks, crowns]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }
    this.trunks = trunks;
    this.canopies = crowns;
    this.wallPos = walls;
  }

  /** Lower walls between the camera (south) and the player so the player is never hidden. */
  cutaway(px: number, pz: number): void {
    if (this.trunks) {
      this.cutTrees(px, pz);
      return;
    }
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

  private cutTrees(px: number, pz: number): void {
    const key = `${Math.floor(px)}:${Math.floor(pz)}`;
    if (key === this.lastCut) return;
    this.lastCut = key;
    // Trees in front of the player fade to stumps and lose their crowns.
    const tmp = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    this.wallPos.forEach((wl, i) => {
      if (wl.h < 1) return;
      const dz = wl.z - pz;
      const dx = Math.abs(wl.x + 0.5 - px);
      const cut = dz > -0.5 && dz < 10 && dx < 9 - dz * 0.25;
      this.trunks!.getMatrixAt(i, tmp);
      tmp.decompose(pos, q, sc);
      const n = ((wl.x * 73856093) ^ (wl.z * 19349663)) >>> 0;
      const tall = 3.4 + ((n >> 8) & 7) * 0.35;
      sc.y = cut ? 0.5 : tall;
      tmp.compose(pos, q, sc);
      this.trunks!.setMatrixAt(i, tmp);
      this.canopies!.getMatrixAt(i, tmp);
      tmp.decompose(pos, q, sc);
      const r = cut ? 0 : 0.9 + ((n >> 14) & 3) * 0.15;
      sc.set(r, cut ? 0 : 2.2 + ((n >> 16) & 3) * 0.3, r);
      tmp.compose(pos, q, sc);
      this.canopies!.setMatrixAt(i, tmp);
    });
    this.trunks!.instanceMatrix.needsUpdate = true;
    this.canopies!.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
