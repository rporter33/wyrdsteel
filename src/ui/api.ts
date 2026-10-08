import type { ContentDb } from '../core/data/types';
import type { Command } from '../core/sim/commands';
import type { World } from '../core/sim/types';

/** What menus may ask of the game. Implemented by src/game; menus never touch the sim directly. */
export interface GameApi {
  db: ContentDb;
  world(): World | null;
  newGame(name: string, cls: string): void;
  command(cmds: Command[]): string[];
  closePanel(): void;
  quitToTitle(): void;
}

let current: GameApi | null = null;
export function setApi(a: GameApi): void {
  current = a;
}
export function api(): GameApi {
  if (!current) throw new Error('game api not ready');
  return current;
}
