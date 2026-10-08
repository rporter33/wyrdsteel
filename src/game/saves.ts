import type { ContentDb } from '../core/data/types';
import type { StorageAdapter, WriteResult } from '../platform/storage/adapter';
import { parseSave, type Skipped } from '../core/save/parse';
import { emptySave, type CharacterSave, type SaveFile } from '../core/save/schema';
import renames from '../data/renames.json';

const KEY = 'wyrdsteel:save';
const BACKUPS = [`${KEY}.bak1`, `${KEY}.bak2`];

export interface LoadResult {
  save: SaveFile;
  skipped: Skipped[];
  /** Which copy loaded: the main file, or a backup because the main one was damaged. */
  source: 'main' | 'backup' | 'new';
}

/**
 * Saves are one JSON document holding the profile (stash, settings) and up to three characters.
 * Each write rotates the previous good copy into two backups, so a torn write never costs more
 * than the last save point.
 */
export class SaveManager {
  current: SaveFile = emptySave();

  constructor(
    private readonly store: StorageAdapter,
    private readonly db: ContentDb,
  ) {}

  get storageName(): string {
    return this.store.name;
  }

  async load(): Promise<LoadResult> {
    const keys = [KEY, ...BACKUPS];
    for (let i = 0; i < keys.length; i++) {
      let text: string | null = null;
      try {
        text = await this.store.read(keys[i]!);
      } catch {
        text = null;
      }
      if (!text) continue;
      const r = parseSave(text, this.db, renames.ids);
      if (r.save) {
        this.current = r.save;
        return { save: r.save, skipped: r.skipped, source: i === 0 ? 'main' : 'backup' };
      }
    }
    this.current = emptySave();
    return { save: this.current, skipped: [], source: 'new' };
  }

  private async writeAll(): Promise<WriteResult> {
    this.current.savedAt = new Date().toISOString();
    const text = JSON.stringify(this.current);
    const prev = await this.store.read(KEY).catch(() => null);
    const res = await this.store.write(KEY, text);
    if (!res.ok) return res;
    // Rotate: the copy we just replaced becomes backup 1, backup 1 becomes backup 2.
    if (prev) {
      const b1 = await this.store.read(BACKUPS[0]!).catch(() => null);
      if (b1) await this.store.write(BACKUPS[1]!, b1);
      await this.store.write(BACKUPS[0]!, prev);
    }
    return res;
  }

  async saveCharacter(cs: CharacterSave, stash: SaveFile['profile']['stash']): Promise<WriteResult> {
    this.current.characters = [...this.current.characters.filter((c) => c.slot !== cs.slot), cs].sort((a, b) => a.slot - b.slot);
    this.current.profile.stash = stash;
    return this.writeAll();
  }

  async saveSettings(settings: SaveFile['profile']['settings']): Promise<WriteResult> {
    this.current.profile.settings = settings;
    return this.writeAll();
  }

  async deleteCharacter(slot: number): Promise<WriteResult> {
    this.current.characters = this.current.characters.filter((c) => c.slot !== slot);
    return this.writeAll();
  }

  exportText(): string {
    return JSON.stringify(this.current, null, 1);
  }

  /** Import a file: it replaces the current save; what couldn't be restored is reported. */
  async importText(text: string): Promise<{ ok: boolean; error?: string; skipped: Skipped[]; write?: WriteResult }> {
    const r = parseSave(text, this.db, renames.ids);
    if (!r.save) return { ok: false, error: r.error ?? 'Unreadable', skipped: r.skipped };
    this.current = r.save;
    const write = await this.writeAll();
    return { ok: true, skipped: r.skipped, write };
  }
}
