import type { ContentDb } from '../core/data/types';
import type { PlayerInput } from '../core/input/frame';
import { Recorder } from '../core/input/replay';
import type { Command } from '../core/sim/commands';
import { applyCommands } from '../core/sim/apply';
import { step } from '../core/sim/step';
import { createWorld, type StartSpec } from '../core/sim/world';
import type { SimEvent, World } from '../core/sim/types';

/**
 * The seam co-op plugs into. A solo session applies local input with no delay; a lockstep or
 * rollback session would implement the same surface over the network.
 */
export interface Session {
  readonly world: World;
  readonly local: number;
  tick(input: PlayerInput): SimEvent[];
  command(cmds: Command[]): string[];
}

export class SoloSession implements Session {
  world: World;
  readonly local = 0;
  recorder: Recorder;

  constructor(
    spec: StartSpec,
    private readonly db: ContentDb,
  ) {
    this.world = createWorld(spec, db);
    this.recorder = new Recorder(spec, db.hash, 300);
  }

  tick(input: PlayerInput): SimEvent[] {
    const f = { tick: this.world.tick, inputs: [input] };
    step(this.world, f, this.db);
    this.recorder.frame(f, this.world);
    return this.world.events;
  }

  /** Menu actions between ticks (the sim is paused while a menu is open in solo play). */
  command(cmds: Command[]): string[] {
    this.recorder.interstitial({ beforeTick: this.world.tick, slot: this.local, cmds });
    return applyCommands(this.world, this.local, cmds, this.db);
  }
}
