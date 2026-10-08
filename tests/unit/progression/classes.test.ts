import { describe, expect, it } from 'vitest';
import { db } from '../_db';
import { runFight } from '../../../src/core/bot/fight';

// The two classes should not be interchangeable: each has matchups it handles much better.
describe('class identity (balance bot, small sample)', () => {
  const kill = (cls: string, enemy: string, seed: number) => runFight(db(), { seed, cls, level: 4, enemies: [enemy, enemy], enemyLevel: 3, policy: 'tactical', maxTicks: 60 * 90 });

  it('both classes can win basic fights', () => {
    for (const cls of ['berserker', 'commando']) {
      const r = kill(cls, 'thrall', 1);
      expect(r.won, `${cls} vs thralls`).toBe(true);
      expect(r.maxHitFrac).toBeLessThanOrEqual(0.35);
    }
  });

  it('kill-time profiles differ by class across archetypes', () => {
    const arche = ['thrall', 'spiker', 'bulwark', 'frostwright'];
    const ratio: number[] = [];
    for (const a of arche) {
      const b = kill('berserker', a, 2);
      const c = kill('commando', a, 2);
      ratio.push(b.ticks / Math.max(1, c.ticks));
    }
    // Not one constant ratio: some fights favour each class.
    const lo = Math.min(...ratio);
    const hi = Math.max(...ratio);
    expect(hi / lo).toBeGreaterThan(1.3);
  });
});
