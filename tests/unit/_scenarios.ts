import { BTN, emptyInput, type PlayerInput } from '../../src/core/input/frame';
import type { StartSpec } from '../../src/core/sim/world';

/** Scripted input runs. Each becomes a golden replay whose hash must not change by accident. */
export interface Scenario {
  name: string;
  start: StartSpec;
  frames: PlayerInput[][];
}

const I = (p: Partial<PlayerInput> = {}): PlayerInput[] => [{ ...emptyInput(), ...p }];
const repeat = (n: number, p: Partial<PlayerInput> = {}) => Array.from({ length: n }, () => I(p));
const tap = (btn: number, extra: Partial<PlayerInput> = {}) => [I({ pressed: btn, held: btn, ...extra })];

export function scenarios(): Scenario[] {
  const combo: PlayerInput[][] = [
    ...repeat(40, { mz: -127 }),
    ...tap(BTN.lock),
    ...repeat(10),
    ...[0, 1, 2, 3].flatMap(() => [...tap(BTN.light), ...repeat(15)]),
    ...repeat(30),
    ...tap(BTN.launcher),
    ...repeat(16, { held: BTN.launcher }),
    ...[0, 1, 2].flatMap(() => [...tap(BTN.light), ...repeat(12)]),
    ...tap(BTN.heavy),
    ...repeat(60),
    ...tap(BTN.dodge, { mx: 127 }),
    ...repeat(30),
    ...tap(BTN.ab1, { ax: -40, az: -30 }),
    ...repeat(60),
  ];
  const rifle: PlayerInput[][] = [...repeat(30, { mz: -127 }), ...repeat(90, { held: BTN.fire, ax: 16, az: -80 }), ...tap(BTN.ab3, { ax: 16, az: -80 }), ...repeat(120)];
  // Into the caldera, lock onto whatever rises, and fight: strings, a heavy, a dodge, for 40 s. Long
  // enough for the guardian to channel and the boss to settle on a read of the player.
  const boss: PlayerInput[][] = [
    ...repeat(110, { mz: -127 }),
    ...tap(BTN.lock),
    ...Array.from({ length: 30 }, (_, i) => [
      ...repeat(20, { mz: -90 }),
      ...[0, 1, 2].flatMap(() => [...tap(BTN.light), ...repeat(12)]),
      ...tap(BTN.heavy),
      ...repeat(18),
      ...tap(BTN.dodge, { mx: i % 2 ? 127 : -127 }),
      ...repeat(8),
    ]).flat(),
  ];
  return [
    { name: 'caldera-boss', start: { seed: 303, players: [{ name: 'G', cls: 'berserker' }], zone: 'roots', node: 'caldera' }, frames: boss },
    { name: 'berserker-combo', start: { seed: 101, players: [{ name: 'G', cls: 'berserker' }], zone: 'training', node: 'training' }, frames: combo },
    { name: 'commando-rifle', start: { seed: 202, players: [{ name: 'G', cls: 'commando' }], zone: 'training', node: 'training' }, frames: rifle },
  ];
}
