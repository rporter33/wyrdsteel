import type { CharacterState } from '../progression/character';
import type { Item } from '../loot/item';

export const SAVE_FORMAT = 'wyrdsteel-save';
export const SAVE_VERSION = 1;
export const SLOTS = 3;

export interface Settings {
  /** 0..1: melee cone and lunge, and gamepad aim magnetism. */
  assist: number;
  difficulty: 0 | 1 | 2;
  cameraDistance: number;
  cameraPitch: number;
  shake: number;
  flash: boolean;
  reducedMotion: boolean;
  volume: number;
  music: number;
  /** Interface text size: 1, 1.15 or 1.3. */
  textScale: number;
  /** Thicker, more opaque telegraphs. */
  boldTelegraphs: boolean;
  /** Graphics preset; 'auto' guesses from the GPU. */
  quality: string;
  showPerf: boolean;
  /** Keyboard rebinding: action -> codes. Empty means defaults. */
  keys: Record<string, string[]>;
  deadzone: number;
}

export const DEFAULT_SETTINGS: Settings = {
  assist: 0.7,
  difficulty: 1,
  cameraDistance: 18,
  cameraPitch: 55,
  shake: 1,
  flash: true,
  reducedMotion: false,
  volume: 0.7,
  music: 0.5,
  textScale: 1,
  boldTelegraphs: false,
  quality: 'auto',
  showPerf: false,
  keys: {},
  deadzone: 0.18,
};

export interface ZoneSave {
  id: string;
  /** Respawn and continue from here (the last waystone). */
  node: string;
  cleared: string[];
  shade: { node: string; x: number; z: number; amount: number } | null;
  mods: string[];
  trial: number;
}

export interface CharacterSave {
  slot: number;
  character: CharacterState;
  zone: ZoneSave;
  difficulty: 0 | 1 | 2;
  seed: number;
  playMs: number;
  savedAt: string;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  v: number;
  contentVersion: number;
  savedAt: string;
  profile: { stash: Item[]; settings: Settings; unlocks: Record<string, number> };
  characters: CharacterSave[];
}

export function emptySave(): SaveFile {
  return { format: SAVE_FORMAT, v: SAVE_VERSION, contentVersion: 1, savedAt: '', profile: { stash: [], settings: { ...DEFAULT_SETTINGS }, unlocks: {} }, characters: [] };
}
