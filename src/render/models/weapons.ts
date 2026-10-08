import * as THREE from 'three';
import { box, cyl, glow } from './kit';
import { PALETTE } from '../materials';

/** Weapon meshes held at the hand pivot, blade pointing along -Y (down the arm) then rotated. */
export function buildWeapon(kind: string, accent: number = PALETTE.rune): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'blades': {
      const b = box(0.06, 0.08, 0.7, PALETTE.steel, 0, 0, 0.35);
      const edge = glow(0.02, accent, 1.6);
      edge.scale.set(1, 1, 16);
      edge.position.set(0, 0.04, 0.38);
      g.add(b, edge, box(0.12, 0.05, 0.08, PALETTE.iron, 0, 0, 0));
      break;
    }
    case 'greataxe': {
      g.add(cyl(0.035, 0.035, 1.5, PALETTE.wood, 5, 0));
      const head = box(0.06, 0.45, 0.4, PALETTE.steel, 0.62, 0, 0.18);
      g.add(head, glow(0.03, accent, 1.5));
      g.rotation.x = Math.PI / 2;
      break;
    }
    case 'sword': {
      g.add(box(0.07, 0.03, 0.95, PALETTE.steel, 0, 0, 0.5), box(0.26, 0.05, 0.05, PALETTE.gold, 0, 0, 0.02));
      const edge = glow(0.015, accent, 1.2);
      edge.scale.set(1, 1, 28);
      edge.position.set(0, 0.02, 0.55);
      g.add(edge);
      break;
    }
    case 'pistols': {
      g.add(box(0.08, 0.12, 0.34, PALETTE.iron, 0.02, 0, 0.12), box(0.06, 0.16, 0.08, PALETTE.wood, -0.06, 0, -0.02));
      break;
    }
    case 'rifle': {
      g.add(box(0.08, 0.12, 0.95, PALETTE.iron, 0, 0, 0.3), box(0.09, 0.14, 0.3, PALETTE.wood, -0.02, 0, -0.12));
      const scope = glow(0.03, accent, 2);
      scope.position.set(0, 0.1, 0.28);
      g.add(scope);
      break;
    }
    case 'cannon': {
      const barrel = cyl(0.12, 0.14, 0.9, PALETTE.iron, 7, 0);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.3;
      const mouth = glow(0.09, PALETTE.ember, 1.4);
      mouth.position.z = 0.76;
      g.add(barrel, mouth);
      break;
    }
    default:
      g.add(box(0.06, 0.06, 0.6, PALETTE.steel, 0, 0, 0.3));
  }
  return g;
}
