import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { T_CRACKED, T_FLOOR, T_ICE, T_LOW, T_PIT, T_WALL } from '../../core/level/grid';
import type { RoomState } from '../../core/sim/types';
import { surface } from '../materials';
import { pbr, type MaterialName } from '../assets';

export interface RoomPalette {
  /** How wall tiles are drawn: fitted blocks, a stand of trees, or broken rock and crystal. */
  style: 'blocks' | 'trees' | 'cliffs';
  floor: number;
  wall: number;
  low: number;
  ice: number;
  pit: number;
  fog: number;
  /** Textured look: material, metres per repeat, tint. */
  floorMat: MaterialName;
  floorScale: number;
  floorTint: number;
  wallMat: MaterialName;
  wallScale: number;
  wallTint: number;
  /** What lies at the bottom of a pit. */
  pitKind: 'abyss' | 'lava' | 'water';
  /** Glowing crystal among the rocks (cliff style), as a colour. */
  crystal?: number;
  /** Tint of the loose rocks along the walls, when it differs from the wall's. */
  rubble?: number;
}

/** A point that gives off light: the renderer lights the few nearest the player. */
export interface LightSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  /** Seconds-scale flicker strength, 0 for steady. */
  flicker: number;
}

export const PALETTES: Record<string, RoomPalette> = {
  hall: { style: 'blocks', floor: 0x5a646e, wall: 0x6b7480, low: 0x4b5560, ice: 0xa8d8f0, pit: 0x05080c, fog: 0x0b1016, floorMat: 'slabs', floorScale: 3, floorTint: 0x9aa4ae, wallMat: 'masonry', wallScale: 2.5, wallTint: 0x8a9098, pitKind: 'abyss' },
  wood: { style: 'trees', floor: 0xdfe8ef, wall: 0x3b3430, low: 0x3d3632, ice: 0xa8d8f0, pit: 0x05080c, fog: 0x8796a3, floorMat: 'snow', floorScale: 4, floorTint: 0xf2f6fa, wallMat: 'bark', wallScale: 1.5, wallTint: 0x9a948e, pitKind: 'water', rubble: 0xc4ccd4 },
  foundry: { style: 'blocks', floor: 0x3b3430, wall: 0x5b4636, low: 0x6b5242, ice: 0xa8d8f0, pit: 0x1a0700, fog: 0x1a120d, floorMat: 'plates', floorScale: 2.5, floorTint: 0xc8c0b8, wallMat: 'rust', wallScale: 2.5, wallTint: 0x8c8580, pitKind: 'lava' },
  wyrd: { style: 'cliffs', floor: 0x2a2440, wall: 0x4a3a6a, low: 0x3a2f55, ice: 0xa8d8f0, pit: 0x05030a, fog: 0x120e1e, floorMat: 'slabs', floorScale: 3, floorTint: 0x5a4f78, wallMat: 'rock', wallScale: 3, wallTint: 0x5e5078, pitKind: 'abyss', crystal: 0xb48cff },
  roots: { style: 'cliffs', floor: 0x5e7486, wall: 0x2e3d4a, low: 0x3b4e5c, ice: 0xbfe8fb, pit: 0x041422, fog: 0x0d1b26, floorMat: 'rock', floorScale: 4, floorTint: 0x8fa4b4, wallMat: 'rock', wallScale: 3, wallTint: 0x6a7c8a, pitKind: 'water', crystal: 0x8fdcff },
};

const WALL_H = 2.8;
const PALETTE_GOLD = 0xf5c542;
const PIT_Y = -0.75;

/** Stable per-tile noise in [0, 1): the same room always looks the same. */
function hash(x: number, z: number, k = 0): number {
  let h = (x * 374761393 + z * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 3D value noise for displacing rock. Cosmetic only, so plain floats are fine here. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const v = (a: number, b: number, c: number) => hash(xi + a, zi + c, yi + b);
  const lx = (b: number, c: number) => v(0, b, c) + (v(1, b, c) - v(0, b, c)) * s(fx);
  const ly = (c: number) => lx(0, c) + (lx(1, c) - lx(0, c)) * s(fy);
  return ly(0) + (ly(1) - ly(0)) * s(fz);
}

/** Box-projected UVs in metres, so any geometry takes a tiling texture without seams per tile. */
function boxUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.set([x, z], i * 2);
    else if (nx >= nz) uv.set([z, y], i * 2);
    else uv.set([x, y], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Cutaway: wall fragments that stand between the camera and the player are thinned with an
 * ordered dither, fading in at the edges, so the player is never hidden and the room keeps its
 * shape. Only what rises above the sight line from the camera to the player's feet is cut.
 * x, z: the player; y: camera height; w: camera's distance south of the player (0 = off).
 */
export const cutUniform = { value: new THREE.Vector4(0, 0, 0, 0) };

function withCutaway<M extends THREE.Material>(m: M): M {
  const c = m.clone();
  c.onBeforeCompile = (shader) => {
    shader.uniforms.uCut = cutUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
vCutWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uCut;
varying vec3 vCutWorld;
float cutBayer(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 i = ivec2(mod(p, 4.0));
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`,
      )
      .replace(
        'void main() {',
        `void main() {
  if (uCut.w > 0.0) {
    float dz = vCutWorld.z - uCut.y;
    float line = 0.1 + (uCut.z - 0.1) * dz / uCut.w;
    float fade = smoothstep(0.3, 1.1, dz) * (1.0 - smoothstep(1.6, 3.0, abs(vCutWorld.x - uCut.x))) * smoothstep(line - 0.8, line + 0.1, vCutWorld.y);
    if (cutBayer(gl_FragCoord.xy) < fade * 0.85) discard;
  }`,
      );
  };
  c.customProgramCacheKey = () => 'cutaway2';
  return c;
}

/**
 * Static room geometry, merged per material: a textured floor, sculpted walls (fitted blocks,
 * trees, or broken rock with crystal), pits with lava or dark water at the bottom, rubble along
 * the walls, and ground beyond. `textured` is off on Low quality: same shapes, flat colour.
 */
export class RoomMesh {
  readonly group = Object.assign(new THREE.Group(), { name: 'room' });
  /** Light given off by the room itself: lava, glowing crystal. */
  readonly lights: LightSpot[] = [];

  constructor(
    readonly room: RoomState,
    readonly palette: RoomPalette,
    readonly textured = true,
  ) {
    this.build();
  }

  private mat(name: MaterialName, scale: number, tint: number, flat: number, extra: { emissive?: number } = {}): THREE.MeshStandardMaterial {
    if (!this.textured) return surface(flat, extra.emissive ? { emissive: flat, emissiveIntensity: extra.emissive } : {});
    return pbr(name, { scale, tint, emissive: extra.emissive });
  }

  private add(g: THREE.BufferGeometry | null, m: THREE.Material, cast = false): void {
    if (!g) return;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private build(): void {
    const { w, h, tiles } = this.room;
    const P = this.palette;
    const at = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h ? T_WALL : tiles[z * w + x]!);
    const walkable = (t: number) => t === T_FLOOR || t === T_ICE || t === T_CRACKED;

    // Floors, by surface.
    const quads: Record<'floor' | 'ice' | 'cracked', number[]> = { floor: [], ice: [], cracked: [] };
    const pits: number[] = [];
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[z * w + x]!;
        if (t === T_FLOOR) quads.floor.push(x, z);
        else if (t === T_ICE) quads.ice.push(x, z);
        else if (t === T_CRACKED) quads.cracked.push(x, z);
        else if (t === T_PIT) pits.push(x, z);
      }
    }
    const plane = (cells: number[], y: number) => {
      if (!cells.length) return null;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < cells.length; i += 2) {
        const x = cells[i]!;
        const z = cells[i + 1]!;
        const b = pos.length / 3;
        pos.push(x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return boxUv(g);
    };
    this.add(plane(quads.floor, 0), this.mat(P.floorMat, P.floorScale, P.floorTint, P.floor));
    this.add(plane(quads.ice, 0.01), this.mat('ice', 3, 0xd8f0ff, P.ice));
    this.add(plane(quads.cracked, 0.01), this.mat('ice', 3, 0x6e8c9c, 0x6e8c9c));

    // Pits: sheer sides down to lava, black water or nothing.
    if (pits.length) {
      const sides: THREE.BufferGeometry[] = [];
      for (let i = 0; i < pits.length; i += 2) {
        const x = pits[i]!;
        const z = pits[i + 1]!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!walkable(at(x + dx, z + dz))) continue;
          const side = new THREE.PlaneGeometry(1, -PIT_Y);
          side.translate(0, PIT_Y / 2, 0);
          side.rotateY(dx === 1 ? -Math.PI / 2 : dx === -1 ? Math.PI / 2 : dz === 1 ? Math.PI : 0);
          side.translate(x + 0.5 + dx * 0.5, 0, z + 0.5 + dz * 0.5);
          sides.push(side);
        }
      }
      if (sides.length) this.add(boxUv(mergeGeometries(sides.map((g) => g.toNonIndexed()), false)!), this.mat(P.wallMat, P.wallScale, P.wallTint, P.wall));
      const bottom = plane(pits, PIT_Y);
      if (P.pitKind === 'lava') {
        this.add(bottom, this.mat('lava', 3, 0xffffff, 0xff5a1a, { emissive: 2.2 }));
        this.spots(pits, 4, 0.4, 0xff6a24, 14, 0.25);
      }
      else if (P.pitKind === 'water') this.add(bottom, new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.08, metalness: 0.2 }));
      else this.add(bottom, surface(0x020305));
    }

    // Ground beyond the walls, so the world doesn't end at the room's edge.
    const ground = new THREE.PlaneGeometry(w + 80, h + 80).rotateX(-Math.PI / 2).translate(w / 2, -0.02, h / 2);
    this.add(boxUv(ground), this.mat(P.floorMat, P.floorScale, P.floorTint, P.floor));

    const walls: { x: number; z: number; low: boolean }[] = [];
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const t = tiles[z * w + x]!;
        if (t !== T_WALL && t !== T_LOW) continue;
        // Only walls that face the room (or lie near it) are built; solid rock far from any floor isn't.
        let near = false;
        for (let dz = -2; dz <= 2 && !near; dz++) for (let dx = -2; dx <= 2 && !near; dx++) near = walkable(at(x + dx, z + dz)) || at(x + dx, z + dz) === T_PIT;
        if (near) walls.push({ x, z, low: t === T_LOW });
      }
    const edge = (x: number, z: number) => [-1, 0, 1].some((dz) => [-1, 0, 1].some((dx) => walkable(at(x + dx, z + dz)) || at(x + dx, z + dz) === T_PIT));
    if (P.style === 'trees') this.trees(walls, edge);
    else if (P.style === 'cliffs') this.cliffs(walls);
    else this.blocks(walls, at);
    this.rubble(at, walkable);
    if (P.style === 'blocks') this.decor(at, walkable);
  }

  /** Fitted blocks (citadel stone, foundry plate) with an overhanging capstone. */
  private blocks(walls: { x: number; z: number; low: boolean }[], at: (x: number, z: number) => number): void {
    const P = this.palette;
    const parts: THREE.BufferGeometry[] = [];
    for (const wl of walls) {
      const hgt = at(wl.x, wl.z) === T_WALL ? WALL_H + Math.floor(hash(wl.x, wl.z) * 3) * 0.25 : 0.9;
      parts.push(new THREE.BoxGeometry(1, hgt, 1).translate(wl.x + 0.5, hgt / 2, wl.z + 0.5));
      if (!wl.low) parts.push(new THREE.BoxGeometry(1.08, 0.18, 1.08).translate(wl.x + 0.5, hgt + 0.09, wl.z + 0.5));
    }
    if (!parts.length) return;
    const g = boxUv(mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!);
    this.add(g, withCutaway(this.mat(P.wallMat, P.wallScale, P.wallTint, P.wall)), true);
  }

  /** Broken rock: lumpy boulders built up into cliffs, with crystal spikes among them. */
  private cliffs(walls: { x: number; z: number; low: boolean }[]): void {
    const P = this.palette;
    const rocks: THREE.BufferGeometry[] = [];
    const crystals: THREE.BufferGeometry[] = [];
    const crystalAt: number[] = [];
    for (const wl of walls) {
      const r = hash(wl.x, wl.z);
      const hgt = wl.low ? 0.9 : WALL_H + r * 1.6;
      const g = new THREE.IcosahedronGeometry(0.85, 2);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const n = 0.75 + noise3(x * 1.7 + wl.x, y * 1.7, z * 1.7 + wl.z) * 0.5;
        pos.setXYZ(i, x * n, y * n, z * n);
      }
      g.scale(1, hgt / 1.6, 1).translate(wl.x + 0.5 + (hash(wl.x, wl.z, 1) - 0.5) * 0.3, hgt * 0.45, wl.z + 0.5 + (hash(wl.x, wl.z, 2) - 0.5) * 0.3);
      g.computeVertexNormals();
      rocks.push(g);
      if (P.crystal && !wl.low && hash(wl.x, wl.z, 3) < 0.22) {
        const c = new THREE.OctahedronGeometry(0.28, 0).scale(0.6, 2.8 + hash(wl.x, wl.z, 4) * 1.5, 0.6);
        c.rotateZ((hash(wl.x, wl.z, 5) - 0.5) * 0.7).rotateX((hash(wl.x, wl.z, 6) - 0.5) * 0.7);
        c.translate(wl.x + 0.5, 0.9, wl.z + 0.5);
        crystals.push(c);
        crystalAt.push(wl.x, wl.z);
      }
    }
    if (rocks.length) this.add(boxUv(mergeGeometries(rocks, false)!), withCutaway(this.mat(P.wallMat, P.wallScale, P.wallTint, P.wall)), true);
    if (crystals.length && P.crystal) {
      this.spots(crystalAt, 5, 1.6, P.crystal, 5, 0);
      const m = this.textured ? pbr('crystal', { scale: 1.5, tint: P.crystal, emissive: 0.6 }) : surface(P.crystal, { emissive: P.crystal, emissiveIntensity: 0.6 });
      this.add(boxUv(mergeGeometries(crystals, false)!), withCutaway(m), true);
    }
  }

  /**
   * The Iron Wood: spruce of stacked, drooping tiers, dark needles with snow lying in patches on
   * the upper faces; fallen logs for low walls. Deeper in the wall band the stand thins out.
   */
  private trees(walls: { x: number; z: number; low: boolean }[], edge: (x: number, z: number) => boolean): void {
    const P = this.palette;
    const trunks: THREE.BufferGeometry[] = [];
    const crowns: THREE.BufferGeometry[] = [];
    const needles = new THREE.Color();
    const snow = new THREE.Color(0xeef3f8);
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (const wl of walls) {
      const jx = (hash(wl.x, wl.z) - 0.5) * 0.5;
      const jz = (hash(wl.x, wl.z, 1) - 0.5) * 0.5;
      if (wl.low) {
        trunks.push(new THREE.CylinderGeometry(0.32, 0.36, 1.6, 10).rotateZ(Math.PI / 2).rotateY(hash(wl.x, wl.z, 2) * 0.6).translate(wl.x + 0.5, 0.32, wl.z + 0.5).toNonIndexed());
        continue;
      }
      if (!edge(wl.x, wl.z) && hash(wl.x, wl.z, 9) > 0.45) continue;
      const tall = 4.5 + hash(wl.x, wl.z, 3) * 2.5;
      const cx = wl.x + 0.5 + jx;
      const cz = wl.z + 0.5 + jz;
      trunks.push(new THREE.CylinderGeometry(0.08, 0.3, tall * 0.8, 8).translate(cx, tall * 0.4, cz).toNonIndexed());
      needles.setHSL(0.38 + hash(wl.x, wl.z, 10) * 0.05, 0.25, 0.1 + hash(wl.x, wl.z, 11) * 0.05);
      const tiers = 4;
      for (let k = 0; k < tiers; k++) {
        const f = k / tiers;
        const r = (1.25 - f * 0.85) * (0.85 + hash(wl.x, wl.z, 4 + k) * 0.3);
        const ht = 1.5 - f * 0.4;
        const cone = new THREE.ConeGeometry(r, ht, 11, 2, true);
        // Droop the rim and break it up, so tiers read as boughs rather than lampshades.
        const pos = cone.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (v.y < -ht / 2 + 0.01) {
            const a = Math.atan2(v.z, v.x);
            const jag = 0.82 + 0.3 * Math.abs(Math.sin(a * 5.5 + k));
            pos.setXYZ(i, v.x * jag, v.y - 0.12 * jag, v.z * jag);
          }
        }
        cone.rotateY(hash(wl.x, wl.z, 12 + k) * 6.28).translate(cx, tall * 0.32 + k * (tall * 0.62) / tiers + ht / 2, cz);
        const g = cone.toNonIndexed();
        g.computeVertexNormals();
        const n = g.getAttribute('normal');
        const p = g.getAttribute('position');
        const col = new Float32Array(n.count * 3);
        for (let i = 0; i < n.count; i++) {
          const lie = noise3(p.getX(i) * 1.9, p.getY(i) * 1.9, p.getZ(i) * 1.9);
          const s = THREE.MathUtils.smoothstep(n.getY(i) * 0.7 + lie * 0.75, 0.72, 0.95);
          c.copy(needles).lerp(snow, s);
          col.set([c.r, c.g, c.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        crowns.push(g);
      }
    }
    if (trunks.length) this.add(boxUv(mergeGeometries(trunks, false)!), withCutaway(this.mat(P.wallMat, P.wallScale, P.wallTint, P.wall)), true);
    if (crowns.length) {
      const m = (this.textured ? pbr('snowsoft', { scale: 2 }) : surface(0xffffff)).clone();
      m.vertexColors = true;
      m.side = THREE.DoubleSide;
      this.add(boxUv(mergeGeometries(crowns, false)!), withCutaway(m), true);
    }
  }

  /**
   * Dressing on the faces of walls that look onto the floor, never on the floor itself: in the
   * citadel, torches in iron sconces (which light the room) and hanging banners; in the foundry,
   * runs of pipe and glowing furnace grates.
   */
  private decor(at: (x: number, z: number) => number, walkable: (t: number) => boolean): void {
    const P = this.palette;
    const { w, h } = this.room;
    const foundry = P.pitKind === 'lava';
    const iron: THREE.BufferGeometry[] = [];
    const flame: THREE.BufferGeometry[] = [];
    const cloth: THREE.BufferGeometry[] = [];
    const trim: THREE.BufferGeometry[] = [];
    // A part placed in a face's own frame: u along the wall, v up, n out into the room.
    const place = (g: THREE.BufferGeometry, x: number, z: number, dx: number, dz: number, u: number, v: number, n: number) => {
      g.rotateY(Math.atan2(dx, dz));
      g.translate(x + 0.5 + dx * (0.5 + n) + dz * u, v, z + 0.5 + dz * (0.5 + n) - dx * u);
      return g;
    };
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        if (at(x, z) !== T_WALL) continue;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          if (!walkable(at(x + dx, z + dz))) continue;
          const r = hash(x * 3 + dx, z * 3 + dz, 11);
          if (foundry) {
            if (r < 0.5) {
              // Two pipes along the face, with a flange.
              iron.push(place(new THREE.CylinderGeometry(0.07, 0.07, 1.02, 8).rotateZ(Math.PI / 2), x, z, dx, dz, 0, 1.9, 0.09));
              iron.push(place(new THREE.CylinderGeometry(0.05, 0.05, 1.02, 8).rotateZ(Math.PI / 2), x, z, dx, dz, 0, 2.15, 0.07));
              if (r < 0.15) iron.push(place(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2), x, z, dx, dz, 0, 1.9, 0.09));
            } else if (r > 0.9) {
              trim.push(place(new THREE.BoxGeometry(0.62, 0.42, 0.06), x, z, dx, dz, 0, 0.75, 0.02));
              flame.push(place(new THREE.BoxGeometry(0.5, 0.3, 0.02), x, z, dx, dz, 0, 0.75, 0.05));
              this.lights.push({ x: x + 0.5 + dx * 0.9, y: 0.8, z: z + 0.5 + dz * 0.9, color: 0xff6a24, intensity: 6, flicker: 0.2 });
            }
          } else if (r < 0.14) {
            // Torch: a bracket, a cup, and the flame.
            iron.push(place(new THREE.BoxGeometry(0.06, 0.06, 0.3), x, z, dx, dz, 0, 1.95, 0.12));
            iron.push(place(new THREE.CylinderGeometry(0.08, 0.05, 0.14, 7), x, z, dx, dz, 0, 2.05, 0.26));
            flame.push(place(new THREE.ConeGeometry(0.07, 0.24, 6).translate(0, 0.12, 0), x, z, dx, dz, 0, 2.1, 0.26));
            // The light sits out from the wall, or the stone beside the flame burns white.
            this.lights.push({ x: x + 0.5 + dx * 1.2, y: 2.2, z: z + 0.5 + dz * 1.2, color: 0xff9a4a, intensity: 5, flicker: 0.35 });
          } else if (r > 0.86) {
            // Banner: a long cloth with a gold band and a pole across the top.
            cloth.push(place(new THREE.PlaneGeometry(0.62, 1.5).translate(0, -0.75, 0), x, z, dx, dz, 0, 2.65, 0.03));
            trim.push(place(new THREE.BoxGeometry(0.62, 0.08, 0.01), x, z, dx, dz, 0, 1.3, 0.035));
            iron.push(place(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6).rotateZ(Math.PI / 2), x, z, dx, dz, 0, 2.65, 0.05));
          }
        }
      }
    const merged = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g;
    }), false) : null);
    this.add(merged(iron), surface(0x2a3038, { metal: 0.8, rough: 0.45 }), true);
    this.add(merged(flame), surface(foundry ? 0xff6a24 : 0xffa04a, { emissive: foundry ? 0xff6a24 : 0xffa04a, emissiveIntensity: 3 }));
    const banner = surface(P.wall === 0x6b7480 ? 0x7a1e22 : 0x3a2a5a, { rough: 0.9 });
    const cl = merged(cloth);
    if (cl) {
      const m = banner.clone();
      m.side = THREE.DoubleSide;
      this.add(cl, m, true);
    }
    this.add(merged(trim), surface(foundry ? 0x2a2420 : PALETTE_GOLD, { metal: foundry ? 0.3 : 0.85, rough: 0.4 }));
  }

  /** Rocks and rubble along the foot of the walls, where floor meets stone. */
  private rubble(at: (x: number, z: number) => number, walkable: (t: number) => boolean): void {
    const P = this.palette;
    const parts: THREE.BufferGeometry[] = [];
    const { w, h } = this.room;
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        if (!walkable(at(x, z))) continue;
        const nearWall = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].find(([dx, dz]) => at(x + dx!, z + dz!) === T_WALL);
        if (!nearWall || hash(x, z, 7) > 0.35) continue;
        const s = 0.12 + hash(x, z, 8) * 0.22;
        const g = new THREE.DodecahedronGeometry(s, 0).scale(1, 0.6, 1);
        g.rotateY(hash(x, z, 9) * 6.28);
        g.translate(x + 0.5 + nearWall[0]! * 0.38, s * 0.3, z + 0.5 + nearWall[1]! * 0.38);
        parts.push(g);
      }
    if (parts.length) this.add(boxUv(mergeGeometries(parts, false)!), this.mat(P.floorMat === 'plates' ? 'rust' : 'rock', 1.5, P.rubble ?? P.wallTint, P.wall), true);
  }

  /** One light per cell of `cell` tiles that holds any of `tiles` (x, z pairs), at their centre. */
  private spots(tiles: number[], cell: number, y: number, color: number, intensity: number, flicker: number): void {
    const cells = new Map<string, [number, number, number]>();
    for (let i = 0; i < tiles.length; i += 2) {
      const k = `${Math.floor(tiles[i]! / cell)},${Math.floor(tiles[i + 1]! / cell)}`;
      const c = cells.get(k) ?? [0, 0, 0];
      c[0] += tiles[i]! + 0.5;
      c[1] += tiles[i + 1]! + 0.5;
      c[2]++;
      cells.set(k, c);
    }
    for (const [x, z, n] of cells.values()) this.lights.push({ x: x / n, y, z: z / n, color, intensity, flicker });
  }

  /** Thin what stands between camera and player; called each frame with both positions. */
  cutaway(px: number, pz: number, camY: number, camZ: number): void {
    cutUniform.value.set(px, pz, camY, Math.max(0.01, camZ - pz));
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
