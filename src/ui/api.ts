import type { ContentDb } from '../core/data/types';
import type { Command } from '../core/sim/commands';
import type { World } from '../core/sim/types';
import type { Settings } from '../core/save/schema';

export interface SlotInfo {
  slot: number;
  name: string | null;
  cls: string;
  level: number;
  where: string;
  savedAt: string;
  playMs: number;
}

/** What menus may ask of the game. Implemented by src/game; menus never touch the sim directly. */
export interface GameApi {
  db: ContentDb;
  world(): World | null;
  newGame(name: string, cls: string, slot?: number): void;
  command(cmds: Command[]): string[];
  closePanel(): void;
  quitToTitle(): void;
  slots(): SlotInfo[];
  loadSlot(slot: number): void;
  deleteSlot(slot: number): Promise<void>;
  settings(): Settings;
  setSettings(s: Settings): Promise<void>;
  exportSave(): void;
  importSave(text: string): Promise<{ ok: boolean; message: string; skipped: string[] }>;
  saveStatus(): { storage: string; lastSavedAgo: number };
}

let current: GameApi | null = null;
export function setApi(a: GameApi): void {
  current = a;
}
export function api(): GameApi {
  if (!current) throw new Error('game api not ready');
  return current;
}
