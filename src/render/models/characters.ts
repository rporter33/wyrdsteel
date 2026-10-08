import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Entity, World } from '../../core/sim/types';
import { model } from '../assets';
import { Animator, ClipLib, HERO_MOVES, type MoveSet } from '../anim/animator';
import { eliteAura, type EnemyModel } from './enemies';
import { PALETTE, surface } from '../materials';
import { buildWeapon } from './weapons';

/**
 * Skinned characters: a CC0 body on the shared skeleton, with armour, weapons and glowing parts
 * hung on its bones. Bodies stand in until generated models replace them; the armour and the
 * clips stay, since every body shares the skeleton.
 */
export interface CharacterAssets {
  lib: ClipLib;
  mannequin: THREE.Object3D;
  male: THREE.Object3D;
  female: THREE.Object3D;
  /** Generated enemy bodies by kind, from characters/generated.json (none until they are made). */
  generated: Record<string, THREE.Object3D>;
}

let ready: CharacterAssets | null = null;
let pending: Promise<CharacterAssets | null> | null = null;

/** The loaded assets, or null until `loadCharacters` resolves (or if it failed). */
export function characterAssets(): CharacterAssets | null {
  return ready;
}

/** The generated bodies listed in the manifest, if there is one; a missing one is not an error. */
async function generatedBodies(): Promise<Record<string, THREE.Object3D>> {
  const res = await fetch('./assets/characters/generated.json').catch(() => null);
  if (!res?.ok) return {};
  const list = (await res.json().catch(() => ({}))) as Record<string, string>;
  const out: Record<string, THREE.Object3D> = {};
  await Promise.all(
    Object.entries(list).map(async ([kind, file]) => {
      out[kind] = (await model(file)).scene;
    }),
  );
  return out;
}

export function loadCharacters(): Promise<CharacterAssets | null> {
  pending ??= Promise.all([model('anims.glb'), model('mannequin.glb'), model('sworn-male.glb'), model('sworn-female.glb'), generatedBodies()])
    .then(([a, m, male, female, generated]) => (ready = { lib: new ClipLib(a.animations), mannequin: m.scene, male: male.scene, female: female.scene, generated }))
    .catch((e: unknown) => {
      console.warn('Character models unavailable; using procedural ones.', e);
      return null;
    });
  return pending;
}

/** Colours of what a body wears, by region: torso and arms, legs, feet, and optionally hands and head. */
interface Clothes {
  top: number;
  legs: number;
  boots: number;
  gloves?: number;
  hood?: number;
}

/** Hard-surface parts: painted metal that catches the light. */
const metal = (c: number) => surface(c, { metal: 0.85, rough: 0.35 });
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const cloth = (c: number) => surface(c, { metal: 0, rough: 0.85 });
const lum = (c: number, i = 2.2) => surface(c, { emissive: c, emissiveIntensity: i });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

/**
 * A body being dressed: parts are placed in rest-pose model space (metres, facing +Z, right hand
 * toward -X) and then hung on a bone, so they follow it through every clip.
 */
class Body {
  readonly root = new THREE.Group();
  readonly scene: THREE.Object3D;
  private readonly v = new THREE.Vector3();

  constructor(src: THREE.Object3D) {
    this.scene = cloneSkinned(src);
    this.root.add(this.scene);
    this.root.updateMatrixWorld(true);
  }

  bone(name: string): THREE.Object3D {
    return this.scene.getObjectByName(name) ?? this.scene;
  }

  /** A bone's rest-pose position in model space. */
  at(name: string): THREE.Vector3 {
    return this.bone(name).getWorldPosition(this.v).clone();
  }

  /**
   * Hang a pivot on a bone at a model-space point; returns it with model-space axes, for parts to
   * be added to. Model hooks scale or turn the pivot, never the bone.
   */
  put(boneName: string, at: THREE.Vector3, ...parts: THREE.Object3D[]): THREE.Group {
    const outer = new THREE.Group();
    outer.position.copy(at);
    this.root.add(outer);
    outer.updateMatrixWorld(true);
    this.bone(boneName).attach(outer);
    const inner = new THREE.Group();
    outer.add(inner);
    for (const p of parts) inner.add(p);
    return inner;
  }

  /** A part along a limb, from bone a toward bone b: centred at `f` of the way, long axis along it. */
  along(a: string, b: string, f: number, part: THREE.Mesh, offset = new THREE.Vector3()): THREE.Group {
    const pa = this.at(a);
    const pb = this.at(b);
    const dir = pb.clone().sub(pa).normalize();
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return this.put(a, pa.lerp(pb, f).add(offset), part);
  }

  /** Recolour the body's own materials by name; hide the parts that map to null. */
  dress(map: (name: string) => THREE.Material | null | undefined): void {
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = map((o.material as THREE.Material).name);
      if (m === null) o.visible = false;
      else if (m) o.material = m;
    });
  }

  /** Scale the whole body (height ratio, then extra girth); parts hung on it scale with it. */
  size(height: number, girth = 1): number {
    const k = height / 1.83;
    this.root.scale.set(k * girth, k, k * girth);
    return k;
  }

  /** Clothes over the skin, by region of the rest pose; set before the template is built. */
  clothes: Clothes | null = null;

  /** Per-vertex clothing colour and coverage at a rest-pose point, from `clothes`. */
  clothing(p: THREE.Vector3): [number, number, number, number] {
    const c = this.clothes;
    if (!c) return [1, 1, 1, 0];
    const y = (name: string) => this.at(name).y;
    this.cut ??= { neck: y('neck_01') + (y('Head') - y('neck_01')) * 0.3, wrist: Math.abs(this.at('hand_r').x) - 0.01, ankle: y('foot_r') + 0.04 * this.root.scale.y, waist: y('pelvis') + 0.03 * this.root.scale.y };
    const k = this.cut;
    const tone = (hex: number, a = 1): [number, number, number, number] => {
      const col = new THREE.Color(hex);
      return [col.r, col.g, col.b, a];
    };
    if (p.y > k.neck) return c.hood === undefined ? [1, 1, 1, 0] : tone(c.hood);
    if (Math.abs(p.x) > k.wrist) return c.gloves === undefined ? [1, 1, 1, 0] : tone(c.gloves);
    if (p.y < k.ankle) return tone(c.boots);
    if (p.y < k.waist) return tone(c.legs);
    return tone(c.top);
  }
  private cut: { neck: number; wrist: number; ankle: number; waist: number } | null = null;

  /** The point a closed fist holds, between the wrist and the knuckles. */
  grip(side: 'l' | 'r'): THREE.Vector3 {
    return this.at(`hand_${side}`).lerp(this.at(`middle_01_${side}`), 0.55).add(new THREE.Vector3(0, -0.02, 0.02));
  }
}

const ZOMBIE: MoveSet = { ...HERO_MOVES, idle: 'Zombie_Idle_Loop', guard: undefined, walk: 'Zombie_Walk_Fwd_Loop', speeds: [1.2, 3.4, 6.2], poses: { slashR: { clip: 'Zombie_Scratch', from: 0.2, to: 1.5, impact: 0.85 }, slashL: { clip: 'Zombie_Scratch', from: 0.2, to: 1.5, impact: 0.85 }, thrust: { clip: 'Zombie_Scratch', from: 0.2, to: 1.5, impact: 0.85 }, overhead: { clip: 'Zombie_Scratch', from: 0.2, to: 1.5, impact: 0.85 } } };
const CASTER: MoveSet = { ...HERO_MOVES, idle: 'Spell_Simple_Idle_Loop', guard: undefined, aim: 'Spell_Simple_Idle_Loop', poses: { shoot: { clip: 'Spell_Simple_Shoot', impact: 0.07 } } };
const SHIELD: MoveSet = { ...HERO_MOVES, idle: 'Idle_Shield_Loop', guard: undefined, poses: { block: { clip: 'Sword_Block', from: 0.2, to: 0.6, impact: 0.35 } } };
const GUNNER: MoveSet = { ...HERO_MOVES, idle: 'Pistol_Idle_Loop', guard: undefined };
const HEAVY: MoveSet = { ...HERO_MOVES, idle: 'Zombie_Idle_Loop', guard: undefined, walk: 'Zombie_Walk_Fwd_Loop', speeds: [1.2, 3.4, 6.2] };

export interface SkinnedModel extends EnemyModel {
  anim: Animator;
  /** Body height over the skeleton's 1.83 m. */
  scale: number;
}

function finish(body: Body, moves: MoveSet, k: number, update?: EnemyModel['update']): SkinnedModel {
  return {
    root: body.root,
    rig: null,
    anim: new Animator(body.scene, characterAssets()!.lib, moves, k),
    scale: k,
    flash: () => {},
    update,
    clothing: body.clothes ? (p) => body.clothing(p) : undefined,
  };
}

export interface HeroStyle {
  cls: string;
  align: string;
  body: number;
  trim: number;
  cape: number;
  meleeKind: string;
  rangedKind: string;
  female: boolean;
}

/** Dress a hero body: clothes over its skin, and its hair and eyes hidden under a helm. */
function wear(body: Body, clothes: Clothes, helmed: boolean): void {
  body.clothes = clothes;
  if (helmed) body.dress((name) => (/Hair|Eye/i.test(name) ? null : undefined));
}

/** Sworn plate: helm with a lit visor, pauldrons, cuirass, gauntlets, greaves, and a cape. */
function swornPlate(body: Body, trim: number, cloak: number, eye: number, cyber: number): void {
  // Plate a shade darker than the trim colour, so it reads as steel rather than mirror.
  const plate = metal(shade(trim, 0.62));
  const dark = metal(0x2a3038);
  // Helm: a rounded shell, a cheek plate either side, a crest, and the visor slit.
  const shell = mesh(new THREE.IcosahedronGeometry(0.15, 1).scale(1, 1.1, 1.12), plate, 0, 0.11, 0);
  const face = mesh(new THREE.BoxGeometry(0.2, 0.15, 0.05), plate, 0, 0.04, 0.13);
  face.rotation.x = -0.12;
  const visor = mesh(new THREE.BoxGeometry(0.17, 0.025, 0.03), lum(eye, 2.6), 0, 0.1, 0.165);
  const brow = mesh(new THREE.BoxGeometry(0.24, 0.04, 0.1), dark, 0, 0.14, 0.1);
  const crest = mesh(new THREE.BoxGeometry(0.03, 0.07, 0.3), dark, 0, 0.27, -0.02);
  body.put('Head', body.at('Head'), shell, face, visor, brow, crest);
  // Torso: cuirass on the upper spine, a core light for the machine-touched, the cape behind.
  const cuirass = mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.4, 10, 1, false).scale(1, 1, 0.7), plate, 0, 0.0, 0.025);
  const parts: THREE.Object3D[] = [cuirass];
  body.put('spine_01', body.at('spine_01'), mesh(new THREE.CylinderGeometry(0.165, 0.17, 0.16, 10).scale(1, 1, 0.72), dark, 0, 0.02, 0.02));
  if (cyber > 0) parts.push(mesh(new THREE.IcosahedronGeometry(0.03 + cyber * 0.015, 0), lum(PALETTE.cyber, 1.5 + cyber), 0, 0.06, 0.17));
  // Gorget over the neck, belt, and cloth tabards front and back in the cloak colour.
  parts.push(mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.08, 10).scale(1, 1, 0.85), dark, 0, 0.2, 0));
  body.put('spine_03', body.at('spine_03'), ...parts);
  const front = mesh(new THREE.BoxGeometry(0.17, 0.3, 0.015), cloth(cloak), 0, -0.17, 0.135);
  const back = mesh(new THREE.BoxGeometry(0.22, 0.34, 0.015), cloth(cloak), 0, -0.18, -0.14);
  front.rotation.x = -0.06;
  back.rotation.x = 0.1;
  body.put('pelvis', body.at('pelvis'), mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.09, 10).scale(1, 1, 0.75), dark, 0, 0.04, 0.0), front, back);
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    // Pauldron over the shoulder, gauntlet on the forearm, tasset, greave and sabaton on the leg.
    const pauldron = mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1.3, 0.75, 1.2), plate, sx * 0.07, 0.05, 0);
    pauldron.rotation.z = -sx * 0.35;
    body.put(`upperarm_${side}`, body.at(`upperarm_${side}`), pauldron);
    body.along(`upperarm_${side}`, `lowerarm_${side}`, 0.55, mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.17, 8), dark));
    body.along(`lowerarm_${side}`, `hand_${side}`, 0.62, mesh(new THREE.CylinderGeometry(0.058, 0.048, 0.2, 7), plate));
    body.along(`thigh_${side}`, `calf_${side}`, 0.42, mesh(new THREE.CylinderGeometry(0.088, 0.075, 0.3, 8), dark), new THREE.Vector3(0, 0, 0.005));
    body.along(`calf_${side}`, `thigh_${side}`, 0.02, mesh(new THREE.SphereGeometry(0.06, 8, 5), plate), new THREE.Vector3(0, 0, 0.05));
    body.along(`calf_${side}`, `foot_${side}`, 0.45, mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 7), plate), new THREE.Vector3(0, 0, 0.02));
    body.along(`foot_${side}`, `ball_${side}`, 0.45, mesh(new THREE.BoxGeometry(0.1, 0.2, 0.08), dark), new THREE.Vector3(0, 0.01, 0));
    if (cyber > 1) body.along(`upperarm_${side}`, `lowerarm_${side}`, 0.5, mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), lum(PALETTE.cyber, 2)), new THREE.Vector3(0, 0.06, 0));
  }
}

/**
 * The Sworn: the hero body in a class-coloured suit under plate, and the equipped weapons on
 * named pivots. Machine-aligned Sworn show more glowing seams; human-aligned ones none.
 */
export function buildSkinnedHero(s: HeroStyle): SkinnedModel {
  const A = characterAssets()!;
  const body = new Body(s.female ? A.female : A.male);
  // A dark undersuit with a hint of the class colour; the plate and tabards carry the colour.
  const suit = new THREE.Color(s.body).lerp(new THREE.Color(0x3a4558), 0.7).getHex();
  wear(body, { top: suit, legs: shade(suit, 0.8), boots: 0x1e2226, gloves: 0x1e2226, hood: 0x1e2226 }, true);
  const cyber = s.align === 'cyber' ? 2 : s.align === 'human' ? 0 : 1;
  swornPlate(body, s.trim, s.cape, s.align === 'human' ? PALETTE.human : PALETTE.cyber, cyber);
  // Weapons: named pivots the view shows or hides by scale.
  const hold = (kind: string, side: 'l' | 'r', name: string, shown: boolean) => {
    const g = body.put(`hand_${side}`, body.grip(side), buildWeapon(kind));
    g.name = name;
    g.scale.setScalar(shown ? 1 : 0);
  };
  hold(s.meleeKind, 'r', 'melee', true);
  if (s.meleeKind === 'blades') hold('blades', 'l', 'meleeL', true);
  hold(s.rangedKind, 'r', 'ranged', false);
  const k = body.size(1.85, s.cls === 'berserker' ? 1.06 : 1);
  return finish(body, HERO_MOVES, k);
}

interface NpcStyle {
  female: boolean;
  clothes: Clothes;
  idle: string;
  height: number;
  girth?: number;
  /** Sworn plate in this trim, or bare-headed. */
  plate?: number;
  dress?: (b: Body) => void;
}

const NPCS: Record<string, NpcStyle> = {
  smith: {
    female: false,
    clothes: { top: 0x6a4a34, legs: 0x3a2a20, boots: 0x2a1e16 },
    idle: 'Idle_Loop',
    height: 1.7,
    girth: 1.2,
    dress: (b) => {
      b.put('spine_03', b.at('spine_03'), mesh(new THREE.BoxGeometry(0.34, 0.75, 0.03), cloth(0x3a2a20), 0, -0.28, 0.15));
      b.put('hand_r', b.grip('r'), mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5).rotateX(Math.PI / 2), cloth(PALETTE.wood), 0, 0, 0.12), mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), metal(PALETTE.iron), 0, 0, 0.36));
    },
  },
  carver: {
    female: false,
    clothes: { top: 0x3a3f5a, legs: 0x2a2f3a, boots: 0x1e2226 },
    idle: 'Idle_Talking_Loop',
    height: 1.8,
    dress: (b) => {
      b.put('Head', b.at('Head'), mesh(new THREE.ConeGeometry(0.17, 0.4, 8), cloth(0x2a2f4a), 0, 0.17, -0.03));
      b.put('hand_l', b.grip('l'), mesh(new THREE.OctahedronGeometry(0.05, 0), lum(PALETTE.rune, 2.6), 0, 0.05, 0));
    },
  },
  well: {
    female: true,
    clothes: { top: 0xe8dcc4, legs: 0x6a8a5a, boots: 0x4a3a2a },
    idle: 'Idle_Loop',
    height: 1.75,
    dress: (b) => {
      b.put('pelvis', b.at('pelvis'), mesh(new THREE.ConeGeometry(0.32, 0.9, 10, 1, true), cloth(0x6a8a5a), 0, -0.36, 0));
      b.put('hand_l', b.grip('l'), mesh(new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lum(PALETTE.human, 2), 0, 0.06, 0));
    },
  },
  board: { female: false, clothes: { top: 0x2d4a3a, legs: 0x23302a, boots: 0x1e2226 }, idle: 'Idle_FoldArms_Loop', height: 1.85, plate: 0xa9b8c4 },
  skald: {
    female: true,
    clothes: { top: 0x6a4a7a, legs: 0x4a2a5a, boots: 0x2a1e16 },
    idle: 'Idle_Talking_Loop',
    height: 1.72,
    dress: (b) => {
      b.put('spine_03', b.at('spine_03'), mesh(new THREE.BoxGeometry(0.42, 0.8, 0.025), cloth(0x4a2a5a), 0, -0.3, -0.16));
      b.put('spine_01', b.at('spine_01'), mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 10).rotateX(Math.PI / 2), cloth(PALETTE.wood), 0.16, 0, 0.1));
    },
  },
  gate: { female: false, clothes: { top: 0x34404a, legs: 0x23282e, boots: 0x1e2226 }, idle: 'Idle_FoldArms_Loop', height: 1.9, plate: 0xe5484d },
  trainer: { female: true, clothes: { top: 0x4a3a34, legs: 0x2a2420, boots: 0x1e2226 }, idle: 'Sword_Idle', height: 1.82, plate: 0x8fb4d6 },
  stash: { female: false, clothes: { top: 0x4a4030, legs: 0x2a2420, boots: 0x2a1e16 }, idle: 'Idle_Loop', height: 1.75, dress: (b) => b.put('spine_01', b.at('spine_01'), mesh(new THREE.BoxGeometry(0.16, 0.16, 0.1), metal(PALETTE.gold), -0.18, -0.05, 0.08)) },
};

/** A citadel townsperson: the hero body in their own clothes, idling in place. */
export function buildSkinnedNpc(id: string): SkinnedModel {
  const A = characterAssets()!;
  const s = NPCS[id] ?? NPCS.board!;
  const body = new Body(s.female ? A.female : A.male);
  wear(body, s.plate === undefined ? s.clothes : { ...s.clothes, gloves: 0x1e2226, hood: 0x1e2226 }, s.plate !== undefined);
  if (s.plate !== undefined) swornPlate(body, s.plate, s.clothes.top, PALETTE.rune, 1);
  if (id === 'trainer') body.put('hand_r', body.grip('r'), buildWeapon('sword'));
  s.dress?.(body);
  const k = body.size(s.height, s.girth ?? 1);
  return finish(body, { ...HERO_MOVES, idle: s.idle, guard: undefined }, k);
}

/** An idle frame's animation input, for townsfolk. */
export const IDLE_INPUT: Parameters<Animator['update']>[0] = { speed: 0, pose: null, t: 0, strike: 0.4, actKey: '', airborne: false, stunned: false, down: false, frozen: false, dead: false, aiming: false, hurt: 0, armed: false, kneel: false };

/** Humanoid enemies that have a skinned version. */
export const SKINNED_ENEMIES = new Set(['thrall', 'spiker', 'bulwark', 'frostwright', 'mender', 'troll', 'jotun', 'golem']);

/**
 * A humanoid enemy. With a generated body (bound to the shared skeleton by the asset build), only
 * what is not part of a body goes on the bones: weapons, shields, and parts the sim changes (plates
 * that break, a heart that is exposed). On the stand-in mannequin, its costume is built in code too.
 */
export function buildSkinnedEnemy(kind: string, colorHex: string, elites: string[]): SkinnedModel {
  const A = characterAssets()!;
  const color = new THREE.Color(colorHex).getHex();
  const gen = A.generated[kind];
  const body = new Body(gen ?? A.mannequin);
  /** Mannequin only: dressing a generated body already has. */
  const costume = (f: () => void) => {
    if (!gen) f();
  };
  const head = body.at('Head');
  const chest = body.at('spine_03');
  const eyes = (c: number, y = 0.1, z = 0.12) => [mesh(new THREE.IcosahedronGeometry(0.022, 0), lum(c, 3), -0.045, y, z), mesh(new THREE.IcosahedronGeometry(0.022, 0), lum(c, 3), 0.045, y, z)];
  const skin = (main: number, joints: number) => costume(() => body.dress((n) => (n === 'M_Main' ? cloth(main) : n === 'M_Joints' ? cloth(joints) : undefined)));
  let moves = HERO_MOVES;
  let height = 1.8;
  let girth = 1;
  let radius = 0.45;
  let update: EnemyModel['update'];
  switch (kind) {
    case 'thrall': {
      // Hunched and fast: a riveted mask, red eyes, bone claws.
      skin(color, 0x2a2420);
      costume(() => body.put('Head', head, mesh(new THREE.BoxGeometry(0.2, 0.2, 0.06), metal(0x3a3430), 0, 0.08, 0.12), ...eyes(PALETTE.blood, 0.11, 0.155)));
      if (!gen) for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const claws = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const c = mesh(new THREE.ConeGeometry(0.018, 0.2, 4), cloth(PALETTE.bone), 0, 0, (i - 1) * 0.035);
          c.rotation.z = -sx * Math.PI / 2;
          claws.add(c);
        }
        body.put(`hand_${side}`, body.at(`middle_01_${side}`).add(new THREE.Vector3(sx * 0.1, 0, 0)), claws);
        body.put(`upperarm_${side}`, body.at(`upperarm_${side}`), mesh(new THREE.ConeGeometry(0.035, 0.16, 4), cloth(PALETTE.bone), sx * 0.04, 0.09, 0));
      }
      moves = ZOMBIE;
      height = 1.5;
      girth = 0.95;
      break;
    }
    case 'spiker': {
      // Hooded marksman with a spike launcher and a quiver of spikes.
      skin(color, 0x23282e);
      costume(() => body.put('Head', head, mesh(new THREE.ConeGeometry(0.17, 0.36, 7), cloth(0x23282e), 0, 0.16, -0.02), ...eyes(0xffd24a)));
      const launcher = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 7).rotateX(Math.PI / 2), metal(PALETTE.iron), 0, 0.02, 0.2);
      body.put('hand_r', body.grip('r'), launcher, mesh(new THREE.IcosahedronGeometry(0.04, 0), lum(0xffd24a, 2), 0, 0.02, 0.5));
      const quiver = new THREE.Group();
      quiver.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 6), cloth(0x3a2a20)));
      for (let i = 0; i < 3; i++) quiver.add(mesh(new THREE.ConeGeometry(0.02, 0.18, 4), metal(PALETTE.steel), (i - 1) * 0.03, 0.3, 0));
      quiver.rotation.z = 0.4;
      costume(() => body.put('spine_03', chest.clone().add(new THREE.Vector3(0.05, 0, -0.16)), quiver));
      moves = GUNNER;
      height = 1.72;
      girth = 0.9;
      break;
    }
    case 'bulwark': {
      // Horned shield-bearer: tower shield on the left forearm, a short spear in the right hand.
      skin(color, 0x3c3c3c);
      const horn = (sx: number) => {
        const h = mesh(new THREE.ConeGeometry(0.045, 0.3, 6), cloth(PALETTE.bone), sx * 0.17, 0.2, 0);
        h.rotation.z = -sx * 0.8;
        return h;
      };
      costume(() => {
        body.put('Head', head, mesh(new THREE.IcosahedronGeometry(0.15, 1).scale(1, 1.05, 1.1), metal(0x4d5862), 0, 0.1, 0.01), horn(1), horn(-1), ...eyes(PALETTE.blood, 0.08, 0.16));
        body.put('spine_03', chest, mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.36, 8).scale(1, 1, 0.7), metal(0x4d5862), 0, 0.03, 0.02));
        for (const side of ['l', 'r'] as const) body.put(`upperarm_${side}`, body.at(`upperarm_${side}`), mesh(new THREE.IcosahedronGeometry(0.12, 1).scale(1.3, 0.8, 1.3), metal(0x4d5862), (side === 'l' ? 1 : -1) * 0.06, 0.07, 0));
      });
      const shield = new THREE.Group();
      // Strapped along the outside of the forearm: in the clips the forearm's rest-pose up stays up,
      // so the board stands in the forearm's vertical plane and faces away from the body.
      shield.add(mesh(new THREE.BoxGeometry(0.62, 1.0, 0.07), metal(0x4d5862)), mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), metal(PALETTE.gold), 0, 0, -0.05));
      body.put('lowerarm_l', body.at('lowerarm_l').lerp(body.at('hand_l'), 0.5).add(new THREE.Vector3(0, 0, -0.08)), shield);
      body.put('hand_r', body.grip('r'), mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5).rotateX(Math.PI / 2), cloth(PALETTE.wood), 0, 0, 0.25), mesh(new THREE.ConeGeometry(0.05, 0.22, 4).rotateX(Math.PI / 2), metal(PALETTE.steel), 0, 0, 0.98));
      moves = SHIELD;
      height = 1.95;
      girth = 1.25;
      radius = 0.6;
      break;
    }
    case 'frostwright': {
      // Ice caster: a crown of crystal, robes, and shards circling it. Floats.
      skin(color, 0xcfe6f5);
      const crown = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const sh = mesh(new THREE.OctahedronGeometry(0.05, 0).scale(0.6, 2.4, 0.6), lum(PALETTE.frost, 1.8), Math.cos(i * 1.26) * 0.13, 0.22, Math.sin(i * 1.26) * 0.13);
        sh.rotation.z = Math.cos(i * 1.26) * -0.35;
        crown.add(sh);
      }
      costume(() => {
        body.put('Head', head, crown, ...eyes(PALETTE.frost));
        body.put('pelvis', body.at('pelvis'), mesh(new THREE.ConeGeometry(0.34, 0.95, 9, 1, true), cloth(0x6aa9cc), 0, -0.4, 0));
      });
      const orbit = new THREE.Group();
      for (let i = 0; i < 4; i++) orbit.add(mesh(new THREE.OctahedronGeometry(0.07, 0).scale(0.6, 2.2, 0.6), lum(PALETTE.frost, 1.5), Math.cos(i * 1.57) * 0.5, 0, Math.sin(i * 1.57) * 0.5));
      const spin = body.put('root', new THREE.Vector3(0, 2.0, 0), orbit);
      moves = CASTER;
      update = (e, w) => {
        body.scene.position.y = 0.2 + Math.sin(w.tick / 15 + e.id) * 0.06;
        spin.rotation.y = w.tick / 40;
        // Fuse: a hot-white swelling before it bursts.
        const f = e.ai?.st === 'fuse' ? 1 + Math.sin(w.tick) * 0.06 + (e.ai.t / 90) * 0.25 : 1;
        body.scene.scale.setScalar(f);
      };
      break;
    }
    case 'mender': {
      // Hooded healer with a staff and a green lamp.
      skin(color, 0x3a5a40);
      costume(() => body.put('Head', head, mesh(new THREE.ConeGeometry(0.16, 0.34, 7), cloth(0x2a4a30), 0, 0.15, -0.02), ...eyes(PALETTE.human)));
      body.put('hand_r', body.grip('r'), mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.6, 5).rotateX(Math.PI / 2), cloth(PALETTE.wood), 0, 0, 0.1), mesh(new THREE.IcosahedronGeometry(0.1, 1), lum(PALETTE.human, 2.5), 0, 0, 0.92));
      costume(() => body.put('pelvis', body.at('pelvis'), mesh(new THREE.ConeGeometry(0.3, 0.8, 9, 1, true), cloth(0x2a4a30), 0, -0.32, 0)));
      moves = CASTER;
      height = 1.6;
      girth = 0.9;
      break;
    }
    case 'troll': {
      // A hulking brute: horned helm, grenade canisters on its back, and four breakable plates.
      skin(color, 0x4a4f55);
      const horn = (sx: number) => {
        const h = mesh(new THREE.ConeGeometry(0.05, 0.3, 6), cloth(PALETTE.bone), sx * 0.15, 0.18, 0.02);
        h.rotation.z = -sx * 0.7;
        return h;
      };
      costume(() => {
        body.put('Head', head, mesh(new THREE.IcosahedronGeometry(0.15, 1), metal(0x4a4f55), 0, 0.08, 0.02), horn(1), horn(-1), ...eyes(0xffd24a, 0.08, 0.16));
        const cans = new THREE.Group();
        for (let i = 0; i < 3; i++) cans.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.32, 7), cloth(0x7a5a2a), -0.15 + i * 0.15, 0, 0));
        body.put('spine_03', chest.clone().add(new THREE.Vector3(0, 0.02, -0.2)), cans);
      });
      const plates: Record<string, THREE.Group> = {};
      for (const side of ['l', 'r'] as const) {
        const sx = side === 'l' ? 1 : -1;
        const S = side.toUpperCase();
        plates[`arm${S}`] = body.put(`upperarm_${side}`, body.at(`upperarm_${side}`), mesh(new THREE.BoxGeometry(0.22, 0.13, 0.22), metal(0x8a8f95), sx * 0.06, 0.08, 0));
        plates[`leg${S}`] = body.along(`calf_${side}`, `foot_${side}`, 0.35, mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), metal(0x8a8f95)), new THREE.Vector3(0, 0, 0.05));
      }
      moves = HEAVY;
      height = 3.1;
      girth = 1.35;
      radius = 1.05;
      update = (e) => {
        for (const p of e.parts ?? []) plates[p.id]?.scale.setScalar(p.broken ? 0 : 1);
      };
      break;
    }
    case 'jotun': {
      // Hrungnir: a stone war-engine with a forge heart behind a chest slab, and a whetstone maul.
      costume(() => body.dress((n) => (n === 'M_Main' ? surface(0x5b6168, { rough: 0.9 }) : n === 'M_Joints' ? surface(0x2f3338, { rough: 0.9 }) : undefined)));
      const horn = (sx: number) => {
        const h = mesh(new THREE.ConeGeometry(0.05, 0.32, 6), cloth(PALETTE.bone), sx * 0.15, 0.2, 0.02);
        h.rotation.z = -sx * 0.6;
        return h;
      };
      costume(() => body.put('Head', head, horn(1), horn(-1), ...eyes(PALETTE.ember, 0.08, 0.14)));
      const heart = body.put('spine_03', chest.clone().add(new THREE.Vector3(0, 0.04, 0.12)), mesh(new THREE.IcosahedronGeometry(0.07, 1), lum(PALETTE.ember, 2.6)));
      const slab = body.put('spine_03', chest.clone().add(new THREE.Vector3(0, 0.1, 0.15)), mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), metal(0x8a8f95), 0, -0.08, 0));
      const pads = (['l', 'r'] as const).map((side) => body.put(`upperarm_${side}`, body.at(`upperarm_${side}`), mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), metal(0x8a8f95), (side === 'l' ? 1 : -1) * 0.06, 0.07, 0)));
      body.put('hand_r', body.grip('r'), mesh(new THREE.BoxGeometry(0.12, 0.12, 0.42), surface(0x8a8f95, { rough: 0.8 }), 0, 0, 0.2));
      moves = HEAVY;
      height = 5.2;
      girth = 1.45;
      radius = 1.9;
      update = (e, w) => {
        const b = e.boss;
        const exposed = (b?.exposed ?? 0) > 0;
        heart.scale.setScalar(exposed ? 1.8 + Math.sin(w.tick / 3) * 0.25 : 1);
        const plated = (b?.plating ?? 0) > 0 ? 1 : 0;
        // The chest slab swings open while the heart vents.
        slab.scale.setScalar(plated || exposed ? 1 : 0);
        slab.rotation.x = exposed ? -1.2 : 0;
        for (const p of pads) p.scale.setScalar(plated);
      };
      break;
    }
    case 'golem': {
      // Mokkurkalfi: a clay giant with a small, frightened mare's heart.
      costume(() => {
        body.dress((n) => (n === 'M_Main' ? surface(0x9a7a5a, { rough: 0.95 }) : n === 'M_Joints' ? surface(0x6b4f36, { rough: 0.95 }) : undefined));
        body.put('Head', head, ...eyes(0xffd24a, 0.07, 0.13));
      });
      const heart = body.put('spine_03', chest.clone().add(new THREE.Vector3(0, 0.03, 0.13)), mesh(new THREE.IcosahedronGeometry(0.035, 1), lum(0xf5c542, 2.2)));
      moves = HEAVY;
      height = 3.6;
      girth = 1.4;
      radius = 1.2;
      update = (e, w) => {
        heart.scale.setScalar(e.ai?.st === 'channel' ? 1.5 + Math.sin(w.tick / 2) * 0.3 : 1);
      };
      break;
    }
    default:
      skin(color, 0x333333);
  }
  const k = body.size(height, girth);
  // Rings for elite affixes, at the feet; scale them back so they keep their size.
  const rings = new THREE.Group();
  rings.scale.set(1 / (k * girth), 1 / k, 1 / (k * girth));
  eliteAura(rings, elites, radius);
  body.root.add(rings);
  return finish(body, moves, k, update);
}

/** What the animator needs from an entity this frame. */
export function animInput(e: Entity, w: World, extra: { pose: string | null; t: number; strike: number; aiming: boolean; armed: boolean }): Parameters<Animator['update']>[0] {
  return {
    // Firing is upper body only, so the legs keep their stride.
    speed: extra.pose && extra.pose !== 'shoot' ? 0 : Math.hypot(e.vx, e.vz),
    pose: extra.pose,
    t: extra.t,
    strike: extra.strike,
    actKey: e.act ? `${e.act.id}|${e.act.node}` : '',
    airborne: e.y > 0.1,
    stunned: e.stun > 0,
    down: (e.stun > 0 && e.stunKind === 2) || (e.y > 0.1 && e.juggle > 0),
    frozen: e.stun > 0 && e.stunKind === 3,
    dead: e.dead,
    aiming: extra.aiming,
    hurt: Math.max(0, 1 - (w.tick - e.hurtAt) / 8),
    armed: extra.armed,
    kneel: (e.parts ?? []).some((p) => p.id.startsWith('leg') && p.broken),
  };
}
