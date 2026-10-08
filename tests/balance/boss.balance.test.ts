import { describe, expect, it } from 'vitest';
import { preparedCharacter } from './_run';
import { runBoss, type BossRun } from './_boss';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const report: string[] = [];

/**
 * The boss contract from the plan: a player who reads telegraphs and answers the guardian wins at
 * least 90% of attempts in three to eight minutes; one who just holds attack does at least 25
 * points worse; no single blow ever takes more than its cap.
 */
describe('Hrungnir', () => {
  for (const [cls, align] of [
    ['berserker', 'cyber'],
    ['commando', 'human'],
  ] as const) {
    it(`${cls}: tactical wins, mashing doesn't, every hit within its cap`, () => {
      const c = preparedCharacter(cls, 14, align);
      const tactical = SEEDS.map((s) => runBoss(c, 'tactical', s));
      const mash = SEEDS.map((s) => runBoss(c, 'mash', s));
      const rate = (rs: BossRun[]) => rs.filter((r) => r.won).length / rs.length;
      const wins = tactical.filter((r) => r.won).map((r) => r.seconds);
      report.push(`${cls.padEnd(10)} tactical ${(rate(tactical) * 100).toFixed(0)}% in ${Math.min(...wins).toFixed(0)}-${Math.max(...wins).toFixed(0)}s; mash ${(rate(mash) * 100).toFixed(0)}%; max hit ${(Math.max(...[...tactical, ...mash].map((r) => r.maxHitFrac)) * 100).toFixed(0)}%; reads seen: ${[...new Set(tactical.flatMap((r) => r.reads))].join(',')}`);
      expect(rate(tactical)).toBeGreaterThanOrEqual(0.9);
      for (const s of wins) {
        expect(s).toBeGreaterThanOrEqual(180);
        expect(s).toBeLessThanOrEqual(480);
      }
      expect(rate(tactical) - rate(mash)).toBeGreaterThanOrEqual(0.25);
      for (const r of [...tactical, ...mash]) expect(r.maxHitFrac).toBeLessThanOrEqual(0.451);
      // Every winning attempt saw all three phases.
      for (const r of tactical.filter((x) => x.won)) expect(r.phase).toBe(3);
    });
  }
  it('report', () => {
    process.stdout.write('\n' + report.join('\n') + '\n');
  });
});
