import { buildHumanoid, type Rig } from './humanoid';
import { PALETTE } from '../materials';
import { box, glow, cyl } from './kit';

/** The hub's people. Each has a silhouette prop so they read at camera distance. */
export function buildNpc(id: string): Rig {
  const styles: Record<string, Parameters<typeof buildHumanoid>[0]> = {
    smith: { body: 0x5a3a2a, trim: 0x3a2a20, skin: 0xb08060, eye: PALETTE.ember, bulk: 1.4, height: 1.55, helm: 'bare', cape: null, cyber: 0 },
    carver: { body: 0x3a3f5a, trim: 0x8fb4d6, skin: 0xc9a68a, eye: PALETTE.rune, bulk: 0.9, height: 1.8, helm: 'hood', cape: 0x2a2f4a, cyber: 0 },
    well: { body: 0xe8dcc4, trim: 0x7fe0a0, skin: 0xd9b89a, eye: PALETTE.human, bulk: 0.85, height: 1.75, helm: 'bare', cape: 0x6a8a5a, cyber: 0 },
    board: { body: 0x2d4a3a, trim: 0xa9b8c4, skin: 0xc9a68a, eye: PALETTE.gold, bulk: 1, height: 1.85, helm: 'crest', cape: 0x2d4a3a, cyber: 0 },
    skald: { body: 0x6a4a7a, trim: 0xf5c542, skin: 0xc9a68a, eye: PALETTE.gold, bulk: 0.9, height: 1.75, helm: 'bare', cape: 0x4a2a5a, cyber: 0 },
    gate: { body: 0x34404a, trim: 0xe5484d, skin: 0xc9a68a, eye: PALETTE.blood, bulk: 1.1, height: 1.9, helm: 'sworn', cape: 0x5a1a1a, cyber: 1 },
    trainer: { body: 0x4a3a34, trim: 0x8fb4d6, skin: 0xc9a68a, eye: PALETTE.cyber, bulk: 1.1, height: 1.85, helm: 'horned', cape: 0x7a2a26, cyber: 1 },
    stash: { body: 0x4a4030, trim: 0xf5c542, skin: 0xc9a68a, eye: PALETTE.gold, bulk: 1, height: 1.7, helm: 'bare', cape: null, cyber: 0 },
  };
  const r = buildHumanoid(styles[id] ?? styles.board!);
  if (id === 'smith') r.handR.add(box(0.2, 0.2, 0.35, 0x2a3038, 0, 0, 0.2));
  if (id === 'well') {
    const bowl = glow(0.12, PALETTE.human, 2);
    bowl.position.set(0, 0.05, 0.15);
    r.handL.add(bowl);
  }
  if (id === 'carver') r.handR.add(glow(0.06, PALETTE.rune, 2.5));
  if (id === 'skald') r.handL.add(cyl(0.12, 0.12, 0.04, PALETTE.wood, 8));
  return r;
}
