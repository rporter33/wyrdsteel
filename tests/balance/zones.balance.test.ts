import { describe, expect, it } from 'vitest';
import { preparedCharacter, runZone } from './_run';

const report: string[] = [];

describe('the bot clears every zone with each class', () => {
  const cases: [string, string, number, 'human' | 'cyber' | null, string[]][] = [
    ['berserker', 'ironwood', 3, null, ['edge', 'clearing', 'grove', 'hollow', 'den']],
    ['commando', 'ironwood', 3, null, ['edge', 'clearing', 'grove', 'hollow', 'den']],
    ['berserker', 'foundry', 8, 'human', ['gate', 'vents', 'catwalks', 'heart']],
    ['commando', 'foundry', 8, 'cyber', ['gate', 'vents', 'smelter', 'heart']],
    ['berserker', 'roots', 12, 'cyber', ['descent', 'geysers', 'pools', 'gate', 'caldera']],
    ['commando', 'roots', 12, 'human', ['descent', 'geysers', 'pools', 'gate', 'caldera']],
  ];
  for (const [cls, zone, level, align, path] of cases) {
    it(`${cls} (${align ?? 'no aspect'}) clears ${zone}`, () => {
      const r = runZone(preparedCharacter(cls, level, align), zone);
      report.push(`${zone.padEnd(9)} ${cls.padEnd(10)} ${(align ?? '-').padEnd(6)} done=${r.done} ${r.seconds.toFixed(0)}s deaths=${r.deaths} maxHit=${(r.maxHitFrac * 100).toFixed(0)}% path=${r.visited.join('>')}`);
      expect(r.visited.slice(0, path.length)).toEqual(path);
      expect(r.done).toBe(true);
      expect(r.deaths).toBeLessThanOrEqual(3);
      expect(r.maxHitFrac).toBeLessThanOrEqual(0.451);
    });
  }
  it('report', () => {
    console.log('\n' + report.join('\n'));
  });
});
