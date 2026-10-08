import * as THREE from 'three';
import { box, cyl, ico, pivot, glow, cone } from './kit';
import { PALETTE } from '../materials';

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  scale: number;
}

export interface HumanoidStyle {
  body: number;
  trim: number;
  skin: number;
  eye: number;
  bulk: number;
  height: number;
  helm: 'sworn' | 'hood' | 'horned' | 'bare' | 'mask' | 'crest';
  cape: number | null;
  cyber: number;
}

export function buildHumanoid(s: HumanoidStyle): Rig {
  const k = s.height / 1.85;
  const b = s.bulk;
  const root = new THREE.Group();
  const hips = pivot(0, 0.95 * k, 0);
  root.add(hips);
  hips.add(box(0.42 * b, 0.22 * k, 0.26 * b, s.trim, 0));
  const torso = pivot(0, 0.1 * k, 0);
  hips.add(torso);
  const chest = box(0.52 * b, 0.5 * k, 0.32 * b, s.body, 0.3 * k);
  torso.add(chest);
  torso.add(box(0.56 * b, 0.12 * k, 0.34 * b, s.trim, 0.52 * k));
  // Pauldrons
  torso.add(box(0.2 * b, 0.12 * k, 0.28 * b, s.trim, 0.56 * k, -0.34 * b));
  torso.add(box(0.2 * b, 0.12 * k, 0.28 * b, s.trim, 0.56 * k, 0.34 * b));
  if (s.cyber > 0) {
    // Machine seams: a glowing spine line and a chest core, brighter the more cyber.
    const core = glow(0.06 + 0.03 * s.cyber, PALETTE.cyber, 1.5 + s.cyber);
    core.position.set(0, 0.36 * k, 0.17 * b);
    torso.add(core);
  }
  if (s.cape !== null) {
    const cape = box(0.46 * b, 0.75 * k, 0.04, s.cape, 0.1 * k, 0, -0.19 * b);
    cape.rotation.x = 0.12;
    torso.add(cape);
  }
  const head = pivot(0, 0.68 * k, 0);
  torso.add(head);
  head.add(box(0.24, 0.26 * k, 0.24, s.skin, 0.13 * k));
  switch (s.helm) {
    case 'sworn': {
      head.add(box(0.29, 0.2 * k, 0.29, s.trim, 0.19 * k));
      const visor = glow(0.04, s.eye, 2);
      visor.scale.set(3.2, 0.6, 1);
      visor.position.set(0, 0.14 * k, 0.14);
      head.add(visor);
      const crest = box(0.05, 0.16, 0.3, s.trim, 0.33 * k);
      head.add(crest);
      break;
    }
    case 'horned': {
      head.add(box(0.3, 0.18 * k, 0.3, s.trim, 0.2 * k));
      const hl = cone(0.05, 0.3, PALETTE.bone);
      hl.position.set(-0.18, 0.32 * k, 0);
      hl.rotation.z = 0.7;
      const hr = hl.clone();
      hr.position.x = 0.18;
      hr.rotation.z = -0.7;
      head.add(hl, hr);
      break;
    }
    case 'hood': {
      const hood = cone(0.22, 0.42 * k, s.trim, 6);
      hood.position.y = 0.2 * k;
      head.add(hood);
      break;
    }
    case 'mask': {
      head.add(box(0.27, 0.27 * k, 0.05, s.trim, 0.13 * k, 0, 0.13));
      break;
    }
    case 'crest': {
      head.add(box(0.29, 0.2 * k, 0.29, s.trim, 0.19 * k));
      const c = box(0.04, 0.24, 0.36, s.eye, 0.36 * k);
      head.add(c);
      break;
    }
    case 'bare':
      break;
  }
  if (s.helm !== 'sworn') {
    const eL = glow(0.025, s.eye, 2);
    eL.position.set(-0.06, 0.15 * k, 0.125);
    const eR = eL.clone();
    eR.position.x = 0.06;
    head.add(eL, eR);
  }
  const arm = (side: number) => {
    const a = pivot(side * 0.33 * b, 0.48 * k, 0);
    a.add(cyl(0.07 * b, 0.065 * b, 0.32 * k, s.body, 6, -0.16 * k));
    const fore = pivot(0, -0.32 * k, 0);
    fore.add(cyl(0.065 * b, 0.075 * b, 0.3 * k, s.trim, 6, -0.15 * k));
    const hand = pivot(0, -0.32 * k, 0.02);
    hand.add(ico(0.07 * b, s.trim));
    fore.add(hand);
    a.add(fore);
    torso.add(a);
    return [a, fore, hand] as const;
  };
  const [armL, foreL, handL] = arm(-1);
  const [armR, foreR, handR] = arm(1);
  const leg = (side: number) => {
    const l = pivot(side * 0.13 * b, 0, 0);
    l.add(cyl(0.09 * b, 0.075 * b, 0.48 * k, s.body, 6, -0.24 * k));
    l.add(box(0.15 * b, 0.42 * k, 0.17 * b, s.trim, -0.7 * k));
    l.add(box(0.15 * b, 0.08, 0.26 * b, s.trim, -0.9 * k, 0, 0.05));
    hips.add(l);
    return l;
  };
  const legL = leg(-1);
  const legR = leg(1);
  return { root, hips, torso, head, armL, armR, foreL, foreR, legL, legR, handL, handR, scale: k };
}
