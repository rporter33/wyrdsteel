import * as THREE from 'three';
import type { Entity, World } from '../../core/sim/types';
import { buildHumanoid, type Rig } from './humanoid';
import { box, cyl, ico, glow, cone } from './kit';
import { PALETTE, toon } from '../materials';

export interface EnemyModel {
  root: THREE.Group;
  rig: Rig | null;
  flash(on: boolean): void;
  update?(e: Entity, w: World): void;
}

const FLASH = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xffe0d0, emissiveIntensity: 0.55 });
const ELITE_COLOR: Record<string, number> = {
  frostbound: 0x9be7ff,
  volatile: 0xff6a3c,
  warded: 0xf5c542,
  linked: 0xc07bff,
  hasted: 0x7fe0a0,
  reinforcing: 0xe5484d,
};

function flasher(root: THREE.Object3D): (on: boolean) => void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial) && !(o.material as THREE.MeshToonMaterial).emissiveIntensity && meshes.push(o));
  const orig = meshes.map((m) => m.material);
  let state = false;
  return (on) => {
    if (on === state) return;
    state = on;
    meshes.forEach((m, i) => (m.material = on ? FLASH : orig[i]!));
  };
}

function eliteAura(root: THREE.Group, elites: string[], r: number): void {
  elites.forEach((id, i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.1 + i * 0.12, r * 1.1 + i * 0.12 + 0.08, 24), new THREE.MeshBasicMaterial({ color: ELITE_COLOR[id] ?? 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
  });
}

export function buildEnemy(model: string, colorHex: string, elites: string[]): EnemyModel {
  const color = new THREE.Color(colorHex).getHex();
  const root = new THREE.Group();
  let rig: Rig | null = null;
  let update: EnemyModel['update'];
  let radius = 0.45;
  switch (model) {
    case 'thrall': {
      rig = buildHumanoid({ body: color, trim: 0x2a2420, skin: 0x3a302a, eye: PALETTE.blood, bulk: 0.85, height: 1.45, helm: 'mask', cape: null, cyber: 0 });
      // Claws.
      rig.handR.add(cone(0.05, 0.3, PALETTE.bone));
      rig.handL.add(cone(0.05, 0.3, PALETTE.bone));
      rig.torso.rotation.x = 0.3;
      break;
    }
    case 'spiker': {
      rig = buildHumanoid({ body: color, trim: 0x23282e, skin: 0x3a302a, eye: 0xffd24a, bulk: 0.8, height: 1.7, helm: 'hood', cape: 0x23282e, cyber: 0 });
      const launcher = cyl(0.08, 0.1, 0.6, PALETTE.iron, 6);
      launcher.rotation.x = Math.PI / 2;
      launcher.position.z = 0.25;
      rig.handR.add(launcher);
      break;
    }
    case 'bulwark': {
      rig = buildHumanoid({ body: color, trim: 0x3c3c3c, skin: 0x3a302a, eye: PALETTE.blood, bulk: 1.3, height: 1.95, helm: 'horned', cape: null, cyber: 0 });
      const shield = box(0.9, 1.3, 0.12, 0x4d5862, 0, 0.1, 0.25);
      shield.add(box(0.3, 0.3, 0.06, PALETTE.gold, 0.1, 0, 0.07));
      rig.handL.add(shield);
      rig.handR.add(box(0.08, 0.08, 0.9, PALETTE.steel, 0, 0, 0.4));
      radius = 0.6;
      break;
    }
    case 'frostwright': {
      rig = buildHumanoid({ body: color, trim: 0xcfe6f5, skin: 0x9fc3d9, eye: PALETTE.frost, bulk: 0.85, height: 1.8, helm: 'crest', cape: 0x6aa9cc, cyber: 0 });
      for (let i = 0; i < 4; i++) {
        const shard = glow(0.07, PALETTE.frost, 1.5);
        shard.scale.set(0.6, 2.2, 0.6);
        shard.position.set(Math.cos(i * 1.57) * 0.45, 2.1, Math.sin(i * 1.57) * 0.45);
        root.add(shard);
      }
      update = (e, w) => {
        rig!.root.position.y = 0.25 + Math.sin(w.tick / 15 + e.id) * 0.06;
        // Fuse: glowing hot-white pulse before self-destruct.
        if (e.ai?.st === 'fuse') rig!.root.scale.setScalar(1 + Math.sin(w.tick) * 0.06 + (e.ai.t / 90) * 0.25);
      };
      break;
    }
    case 'mender': {
      rig = buildHumanoid({ body: color, trim: 0x3a5a40, skin: 0x7a6a5a, eye: PALETTE.human, bulk: 0.8, height: 1.55, helm: 'hood', cape: 0x2a4a30, cyber: 0 });
      const staff = cyl(0.03, 0.03, 1.6, PALETTE.wood, 5);
      staff.rotation.x = Math.PI / 2;
      staff.position.z = 0.4;
      const lamp = glow(0.12, PALETTE.human, 2.5);
      lamp.position.z = 1.2;
      rig.handR.add(staff, lamp);
      break;
    }
    case 'troll': {
      rig = buildHumanoid({ body: color, trim: 0x4a4f55, skin: 0x6b6f5a, eye: 0xffd24a, bulk: 2.1, height: 3.1, helm: 'horned', cape: null, cyber: 0 });
      // Grenade canisters on its back.
      const cans = new THREE.Group();
      for (let i = 0; i < 3; i++) cans.add(cyl(0.14, 0.14, 0.6, 0x7a5a2a, 7, 0).translateX(-0.35 + i * 0.35));
      cans.position.set(0, 0.55, -0.55);
      rig.torso.add(cans);
      // Breakable plates: shoulders and shins. Hidden when the sim reports the part broken.
      const plates: Record<string, THREE.Object3D[]> = { armL: [], armR: [], legL: [], legR: [] };
      const plate = (g: THREE.Group, key: string, y: number) => {
        const piv = new THREE.Group();
        piv.name = `plate:${key}`;
        piv.add(box(0.42, 0.28, 0.42, 0x8a8f95, y));
        g.add(piv);
        plates[key]!.push(piv);
      };
      plate(rig.armL, 'armL', -0.05);
      plate(rig.armR, 'armR', -0.05);
      plate(rig.legL, 'legL', -1.05);
      plate(rig.legR, 'legR', -1.05);
      radius = 1.05;
      update = (e) => {
        for (const p of e.parts ?? []) for (const o of plates[p.id] ?? []) o.scale.setScalar(p.broken ? 0 : 1);
        const kneel = (e.parts ?? []).filter((p) => p.id.startsWith('leg') && p.broken).length;
        if (kneel > 0 && rig) rig.hips.position.y -= 0.5;
      };
      break;
    }
    case 'burrower': {
      const seg = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const s = ico(0.42 - i * 0.04, i === 0 ? 0x5a4a6a : color, 0);
        s.position.set(0, 0.4, -i * 0.5);
        seg.add(s);
      }
      const maw = glow(0.15, PALETTE.ember, 2);
      maw.position.set(0, 0.45, 0.35);
      seg.add(maw);
      root.add(seg);
      update = (e, w) => {
        const burrowed = e.ai?.st === 'burrowed' || e.ai?.st === 'travel';
        seg.position.y = burrowed ? -1.2 : e.ai?.st === 'emerge' ? -1.2 + Math.min(1, (e.ai.t ?? 0) / 20) * 1.2 : 0;
        seg.children.forEach((c, i) => (c.position.x = Math.sin(w.tick / 6 - i) * 0.12));
        seg.rotation.y = Math.atan2(e.fx, e.fz);
      };
      radius = 0.55;
      break;
    }
    case 'jotun': {
      // Hrungnir: a stone war-engine with a forge heart and a whetstone maul.
      rig = buildHumanoid({ body: 0x5b6168, trim: 0x2f3338, skin: 0x5b6168, eye: PALETTE.ember, bulk: 3, height: 5.2, helm: 'horned', cape: null, cyber: 0 });
      const heart = glow(0.35, PALETTE.ember, 2.5);
      heart.position.set(0, 0.55 * rig.scale, 0.52);
      rig.torso.add(heart);
      const whet = box(0.5, 0.5, 1.8, 0x8a8f95, 0, 0, 0.8);
      rig.handR.add(whet);
      radius = 1.9;
      update = (e, w) => {
        const exposed = (e.boss?.exposed ?? 0) > 0;
        heart.scale.setScalar(exposed ? 1.6 + Math.sin(w.tick / 3) * 0.2 : 1);
        const plating = e.boss?.plating ?? 0;
        rig!.torso.children[0]!.scale.setScalar(1 + plating * 0.0006);
      };
      break;
    }
    case 'golem': {
      rig = buildHumanoid({ body: 0x9a7a5a, trim: 0x6b4f36, skin: 0x9a7a5a, eye: 0xffd24a, bulk: 2.2, height: 3.6, helm: 'bare', cape: null, cyber: 0 });
      radius = 1.2;
      break;
    }
    case 'generator': {
      // Shield pylon: an iron column with a gold core and three fins.
      root.add(cyl(0.45, 0.6, 1.5, PALETTE.iron, 8, 0.75));
      const core = glow(0.32, PALETTE.gold, 2.2);
      core.position.y = 1.75;
      root.add(core);
      for (let i = 0; i < 3; i++) {
        const fin = box(0.08, 1.0, 0.5, 0x5b4636, 1.0);
        fin.position.x = Math.cos(i * 2.09) * 0.5;
        fin.position.z = Math.sin(i * 2.09) * 0.5;
        fin.rotation.y = -i * 2.09;
        root.add(fin);
      }
      update = (_e, w) => {
        core.scale.setScalar(1 + Math.sin(w.tick / 8) * 0.12);
      };
      radius = 0.6;
      break;
    }
    case 'dummy': {
      const post = cyl(0.12, 0.15, 1.6, PALETTE.wood, 6, 0.8);
      const body = cyl(0.35, 0.3, 0.9, 0xb89a6a, 7, 1.2);
      const head = ico(0.22, 0xb89a6a);
      head.position.y = 1.85;
      const arms = box(1.1, 0.12, 0.12, PALETTE.wood, 1.4);
      root.add(post, body, head, arms);
      break;
    }
    default: {
      rig = buildHumanoid({ body: color, trim: 0x333333, skin: 0x555555, eye: PALETTE.blood, bulk: 1, height: 1.8, helm: 'mask', cape: null, cyber: 0 });
    }
  }
  if (rig) root.add(rig.root);
  eliteAura(root, elites, radius);
  return { root, rig, flash: flasher(root), update };
}

export { toon };
