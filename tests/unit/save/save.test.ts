import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../_db';
import { ROOT } from '../_files';
import { training, tickN } from '../_world';
import { parseSave } from '../../../src/core/save/parse';
import { characterSave, startFrom } from '../../../src/core/save/serialize';
import { createWorld, playerEntity } from '../../../src/core/sim/world';
import { emptySave } from '../../../src/core/save/schema';
import { makeItem } from '../../../src/core/loot/item';
import { SaveManager } from '../../../src/game/saves';
import { MemoryAdapter } from '../../../src/platform/storage/memory';
import { computeStats } from '../../../src/core/progression/derive';
import renames from '../../../src/data/renames.json';

describe('save files', () => {
  it('round-trips a character exactly and resumes at the last waystone', () => {
    const { w } = training();
    const c = w.players[0]!.character;
    c.level = 7;
    c.xp = 2100;
    c.bounty = 999;
    c.inv.push(makeItem('w.axe.2', 'ascendant', 8, 'axe', [{ id: 'savage.2', v: 0.12 }], 2));
    c.runes['rune.isa.2'] = 1;
    c.skills.cls['zk.wolf.hide'] = 3;
    w.zone.cleared.push('arena');
    const file = emptySave();
    file.characters.push(characterSave(w, 0, 0, 5000, '2026-10-08T00:00:00Z'));
    const text = JSON.stringify(file);
    const r = parseSave(text, db());
    expect(r.error).toBeNull();
    expect(r.skipped).toEqual([]);
    expect(r.save!.characters[0]!.character).toEqual(c);
    const w2 = createWorld(startFrom(r.save!.characters[0]!, [], 42), db());
    expect(w2.players[0]!.character).toEqual(c);
    expect(w2.zone.cleared).toContain('arena');
    expect(playerEntity(w2, 0)!.hpMax).toBe(computeStats(c, db()).hpMax);
  });

  it('restores what it can from a damaged file and reports each thing it dropped', () => {
    const text = readFileSync(join(ROOT, 'tests/fixtures/saves/damaged-v1.json'), 'utf8');
    const r = parseSave(text, db(), renames.ids);
    expect(r.error).toBeNull();
    const s = r.save!;
    // The good character survives; the one with an unknown class does not.
    expect(s.characters.map((c) => c.character.name)).toEqual(['Hild']);
    const c = s.characters[0]!.character;
    expect(c.level).toBe(6);
    expect(c.equip.melee!.affixes.map((a) => a.id)).toEqual(['brutal.2']);
    expect(c.equip.melee!.sockets).toEqual(['rune.tyr.1', null]);
    // Renamed ids resolve to their current names.
    expect(c.equip.ranged!.base).toBe('w.pistols.1');
    // rune.tiwaz.1 was renamed to rune.tyr.1: both entries land on the same key.
    expect(c.runes['rune.tyr.1']).toBe(3);
    expect(c.inv.map((i) => i.uid)).toEqual(['i1']);
    expect(c.charms.map((q) => q.id)).toEqual(['charm.wolf']);
    expect(c.blueprints).toEqual(['bp.wolfblades']);
    expect(s.characters[0]!.zone.cleared).toEqual(['arena']);
    expect(s.profile.stash.map((i) => i.uid)).toEqual(['s1']);
    expect(s.profile.settings.assist).toBe(0.4);
    expect(s.profile.settings.volume).toBe(0.7);
    const paths = r.skipped.map((x) => x.path);
    expect(paths).toEqual(expect.arrayContaining(['stash[1]', 'settings.volume', 'characters[0].equip.melee.affixes[1]', 'characters[0].equip.melee.sockets[1]', 'characters[0].inv[1]', 'characters[0].inv[2]', 'characters[1]']));
  });

  it('migrates an old single-character file', () => {
    const v0 = { format: 'wyrdsteel-save', v: 0, character: { slot: 0, character: { name: 'Old', cls: 'commando', level: 3 }, zone: { id: 'training', node: 'training' } } };
    const r = parseSave(JSON.stringify(v0), db());
    expect(r.error).toBeNull();
    expect(r.save!.v).toBe(1);
    expect(r.save!.characters[0]!.character.name).toBe('Old');
  });

  it('refuses files that are not saves, or from a newer version', () => {
    expect(parseSave('{nope', db()).error).toMatch(/JSON/);
    expect(parseSave('{"format":"other"}', db()).error).toMatch(/Not a Wyrdsteel/);
    expect(parseSave('{"format":"wyrdsteel-save","v":99}', db()).error).toMatch(/newer/);
  });

  it('an invalid skill allocation is refunded, not half-kept', () => {
    const { w } = training();
    const file = emptySave();
    const cs = characterSave(w, 0, 0, 0, '');
    cs.character.skills.cls = { 'zk.wolf.fenrir': 1 };
    file.characters.push(cs);
    const r = parseSave(JSON.stringify(file), db());
    expect(r.save!.characters[0]!.character.skills.cls).toEqual({});
    expect(r.skipped.some((x) => x.reason.includes('refunded'))).toBe(true);
  });
});

describe('save manager', () => {
  it('writes, rotates two backups, and loads a backup when the main copy is damaged', async () => {
    const mem = new MemoryAdapter();
    const m = new SaveManager(mem, db());
    const { w } = training();
    for (let i = 0; i < 3; i++) {
      w.players[0]!.character.bounty = i * 100;
      expect((await m.saveCharacter(characterSave(w, 0, 0, i, ''), [])).ok).toBe(true);
    }
    expect(Object.keys(mem.data).sort()).toEqual(['wyrdsteel:save', 'wyrdsteel:save.bak1', 'wyrdsteel:save.bak2']);
    mem.data['wyrdsteel:save'] = '{"format":"wyrdsteel-save","v":1,"chara';
    const loaded = await new SaveManager(mem, db()).load();
    expect(loaded.source).toBe('backup');
    expect(loaded.save.characters[0]!.character.bounty).toBe(100);
  });

  it('a refused write is reported, never swallowed', async () => {
    const mem = new MemoryAdapter();
    mem.refuse = { ok: false, reason: 'quota', message: 'QuotaExceededError' };
    const m = new SaveManager(mem, db());
    const { w } = training();
    const res = await m.saveCharacter(characterSave(w, 0, 0, 0, ''), []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('quota');
  });

  it('import replaces the save and lists what it skipped; export is re-importable', async () => {
    const m = new SaveManager(new MemoryAdapter(), db());
    const text = readFileSync(join(ROOT, 'tests/fixtures/saves/damaged-v1.json'), 'utf8');
    const r = await m.importText(text);
    expect(r.ok).toBe(true);
    expect(r.skipped.length).toBeGreaterThan(5);
    const again = await new SaveManager(new MemoryAdapter(), db()).importText(m.exportText());
    expect(again.ok).toBe(true);
    expect(again.skipped).toEqual([]);
  });

  void tickN;
});
