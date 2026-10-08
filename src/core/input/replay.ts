import type { ContentDb } from '../data/types';
import { createWorld, type StartSpec } from '../sim/world';
import { step } from '../sim/step';
import { hashWorld } from '../sim/hash';
import type { Command } from '../sim/commands';
import { applyCommands } from '../sim/apply';
import type { World } from '../sim/types';
import { emptyInput, sameInput, type InputFrame, type PlayerInput } from './frame';

/** Bumped whenever a sim change intentionally alters outcomes; golden replays then re-baseline. */
export const SIM_VERSION = 3;

/** Run-length encoded frames: [repeat count, inputs per slot]. */
export type RleFrames = [number, PlayerInput[]][];

export interface Interstitial {
  beforeTick: number;
  slot: number;
  cmds: Command[];
}

export interface Replay {
  v: 1;
  simVersion: number;
  contentHash: string;
  start: StartSpec;
  frames: RleFrames;
  interstitials: Interstitial[];
  checkpoints: { tick: number; hash: string }[];
}

export function encodeFrames(frames: PlayerInput[][]): RleFrames {
  const out: RleFrames = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && last[1].length === f.length && last[1].every((x, i) => sameInput(x, f[i]!))) last[0]++;
    else out.push([1, f.map((x) => ({ ...x }))]);
  }
  return out;
}

export function decodeFrames(r: RleFrames): PlayerInput[][] {
  const out: PlayerInput[][] = [];
  for (const [n, f] of r) for (let i = 0; i < n; i++) out.push(f.map((x) => ({ ...x })));
  return out;
}

/** Records what a session fed the sim so the run can be reproduced exactly. */
export class Recorder {
  private frames: PlayerInput[][] = [];
  private inter: Interstitial[] = [];
  private checks: { tick: number; hash: string }[] = [];
  constructor(
    private readonly start: StartSpec,
    private readonly contentHash: string,
    private readonly checkEvery = 0,
  ) {}
  frame(f: InputFrame, after: World): void {
    this.frames.push(f.inputs.map((x) => ({ ...x })));
    if (this.checkEvery > 0 && after.tick % this.checkEvery === 0) this.checks.push({ tick: after.tick, hash: hashWorld(after) });
  }
  interstitial(i: Interstitial): void {
    this.inter.push({ ...i, cmds: i.cmds.map((c) => ({ ...c })) });
  }
  get length(): number {
    return this.frames.length;
  }
  build(): Replay {
    return {
      v: 1,
      simVersion: SIM_VERSION,
      contentHash: this.contentHash,
      start: this.start,
      frames: encodeFrames(this.frames),
      interstitials: this.inter,
      checkpoints: this.checks,
    };
  }
}

export interface ReplayResult {
  world: World;
  /** First checkpoint whose hash did not match, if any: where a desync starts. */
  mismatch: { tick: number; expected: string; actual: string } | null;
}

export function runReplay(r: Replay, db: ContentDb, onTick?: (w: World) => void): ReplayResult {
  const w = createWorld(r.start, db);
  const frames = decodeFrames(r.frames);
  const checks: Record<string, string> = {};
  for (const c of r.checkpoints) checks[String(c.tick)] = c.hash;
  let mismatch: ReplayResult['mismatch'] = null;
  let ii = 0;
  for (let i = 0; i < frames.length; i++) {
    while (ii < r.interstitials.length && r.interstitials[ii]!.beforeTick === w.tick) {
      const it = r.interstitials[ii++]!;
      applyCommands(w, it.slot, it.cmds, db);
    }
    const inputs = frames[i]!;
    step(w, { tick: w.tick, inputs: inputs.length ? inputs : [emptyInput()] }, db);
    onTick?.(w);
    const want = checks[String(w.tick)];
    if (want && !mismatch) {
      const got = hashWorld(w);
      if (got !== want) mismatch = { tick: w.tick, expected: want, actual: got };
    }
  }
  return { world: w, mismatch };
}
