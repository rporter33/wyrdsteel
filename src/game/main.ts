import { render, h } from 'preact';
import * as THREE from 'three';
import { loadContent } from '../core/data/load';
import { packs } from '../data';
import { GameRenderer } from '../render/scene';
import { InputSampler } from '../platform/input/sampler';
import { startLoop } from '../platform/loop';
import { pickStorage } from '../platform/storage/indexeddb';
import { DEFAULT_KEYS } from '../platform/input/bindings';
import { SoloSession } from './session';
import { SaveManager } from './saves';
import { App } from '../ui/menus/App';
import { Hud } from '../ui/hud/hud';
import { setApi, type SlotInfo } from '../ui/api';
import { panel, screen, version, toast, dialogue, type Panel } from '../ui/store';
import type { SimEvent } from '../core/sim/types';
import { installDebug, type Autopilot } from './debug';
import { eventToasts } from './feedback';
import { MenuPad, installArrowKeys } from '../ui/focus';
import { AudioEngine } from '../audio/engine';
import { playEvents } from '../audio/sfx';
import { characterSave, startFrom } from '../core/save/serialize';
import { DEFAULT_SETTINGS, SLOTS, type Settings } from '../core/save/schema';
import type { StartSpec } from '../core/sim/world';
import type { ButtonName } from '../core/input/frame';
import type { WriteResult } from '../platform/storage/adapter';

const params = new URLSearchParams(location.search);
const db = loadContent(packs);
const canvas = document.getElementById('view') as HTMLCanvasElement;
canvas.tabIndex = 0;
const gfx = new GameRenderer(canvas, db);
gfx.opts.lowFx = params.has('lowfx');
const input = new InputSampler(canvas);
const hud = new Hud(document.getElementById('hud')!);

const audio = new AudioEngine();
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true });
const panVec = new THREE.Vector3();
const pan = (x: number, z: number) => {
  panVec.set(x, 1, z).project(gfx.rig.camera);
  return Math.max(-1, Math.min(1, panVec.x * 0.8));
};
const SANDBOX_HINT = 'Training yard\nLMB light · E heavy · Q launcher (hold to follow up)\nSpace dodge · RMB fire · Shift precise aim\n1-4 abilities · Tab lock on, wheel cycles · C flask\nIn the air: LMB air string, E slam · Esc pause';

// ---- State ----
let session: SoloSession | null = null;
let saveSlot = 0;
let playMs = 0;
let lastSaved = 0;
let pendingEvents: SimEvent[] = [];
let frames = 0;
let settings: Settings = { ...DEFAULT_SETTINGS };
let saves: SaveManager | null = null;
let mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, inside: true };
});

const local = () => {
  const w = session?.world;
  return w ? (w.entities.find((x) => x.id === w.players[0]?.entity) ?? null) : null;
};

const aim = {
  cursorWorld: () => (mouse.inside ? gfx.rig.pointToWorld(mouse.x, mouse.y) : null),
  playerPos: () => {
    const e = local();
    return e ? { x: e.x, z: e.z } : null;
  },
  parkTarget: () => {
    const w = session?.world;
    const e = local();
    const t = e?.pl ? w!.entities.find((x) => x.id === (e.pl!.lock || e.pl!.soft)) : null;
    return t ? { x: t.x, z: t.z } : null;
  },
};

// ---- Settings ----
function applySettings(s: Settings): void {
  settings = s;
  gfx.rig.settings.distance = s.cameraDistance;
  gfx.rig.settings.pitchDeg = s.cameraPitch;
  gfx.opts.shake = s.reducedMotion ? 0 : s.shake;
  gfx.opts.flash = s.flash && !s.reducedMotion;
  audio.setVolume(s.volume);
  hud.showPerf = s.showPerf || params.has('perf');
  input.deadzone = s.deadzone;
  const keys = structuredClone(DEFAULT_KEYS);
  for (const [k, v] of Object.entries(s.keys)) if (k in keys && Array.isArray(v)) keys[k as ButtonName] = v;
  input.bindings = keys;
  document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
  if (session) {
    session.command([{ t: 'assist', value: s.assist }]);
  }
}

// ---- Saving ----
function exportSave(): void {
  if (!saves) return;
  const blob = new Blob([saves.exportText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wyrdsteel-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function reportWrite(res: WriteResult): void {
  if (res.ok) return;
  const why = res.reason === 'quota' ? 'browser storage is full' : res.reason === 'denied' ? 'this browser is blocking storage (private mode?)' : 'the browser refused the write';
  toast(`Couldn't save: ${why}. Export a copy so nothing is lost.`, 'error', { label: 'Export now', run: exportSave }, 0);
}

async function saveNow(reason: string): Promise<void> {
  if (!session || !saves) return;
  const w = session.world;
  if (w.players[0]!.character && !w.entities.find((e) => e.id === w.players[0]!.entity)?.dead) {
    const res = await saves.saveCharacter(characterSave(w, 0, saveSlot, playMs, new Date().toISOString()), w.stash.map((i) => ({ ...i })));
    if (res.ok) {
      lastSaved = performance.now();
      version.value++;
    }
    reportWrite(res);
    void reason;
  }
}

function slots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const c = saves?.current.characters.find((x) => x.slot === i);
    out.push(
      c
        ? { slot: i, name: c.character.name, cls: db.classes[c.character.cls]?.name ?? c.character.cls, level: c.character.level, where: db.zones[c.zone.id]?.name ?? c.zone.id, savedAt: c.savedAt, playMs: c.playMs }
        : { slot: i, name: null, cls: '', level: 0, where: '', savedAt: '', playMs: 0 },
    );
  }
  return out;
}

// ---- Sessions ----
function begin(spec: StartSpec, slot: number, ms: number): void {
  saveSlot = slot;
  playMs = ms;
  session = new SoloSession(spec, db);
  session.command([{ t: 'assist', value: settings.assist }]);
  gfx.invalidate();
  gfx.rig.snap(local()?.x ?? 0, local()?.z ?? 0);
  screen.value = 'game';
  panel.value = null;
  canvas.focus();
  version.value++;
}

function seedFor(): number {
  return params.has('seed') ? hashSeed(params.get('seed')!) : (Math.random() * 2 ** 32) >>> 0;
}

function newGame(name: string, cls: string, slot?: number): void {
  const s = slot ?? slots().find((x) => !x.name)?.slot ?? 0;
  begin({ seed: seedFor(), players: [{ name, cls }], zone: 'citadel', node: 'hub', difficulty: settings.difficulty, stash: saves?.current.profile.stash ?? [] }, s, 0);
  void saveNow('new');
}

function loadSlot(slot: number): void {
  const cs = saves?.current.characters.find((c) => c.slot === slot);
  if (!cs || !saves) return;
  begin(startFrom(cs, saves.current.profile.stash, seedFor()), slot, cs.playMs);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

setApi({
  db,
  world: () => session?.world ?? null,
  newGame,
  command: (cmds) => {
    const r = session?.command(cmds) ?? [];
    version.value++;
    return r;
  },
  closePanel: () => {
    panel.value = null;
    canvas.focus();
  },
  quitToTitle: () => {
    session = null;
    panel.value = null;
    screen.value = 'title';
    version.value++;
  },
  slots,
  loadSlot,
  deleteSlot: async (slot) => {
    if (!saves) return;
    reportWrite(await saves.deleteCharacter(slot));
    version.value++;
  },
  settings: () => settings,
  setSettings: async (s) => {
    applySettings(s);
    if (saves) reportWrite(await saves.saveSettings(s));
    version.value++;
  },
  exportSave,
  importSave: async (text) => {
    if (!saves) return { ok: false, message: 'Storage not ready', skipped: [] };
    const r = await saves.importText(text);
    if (r.write) reportWrite(r.write);
    if (r.ok) applySettings(saves.current.profile.settings);
    version.value++;
    return { ok: r.ok, message: r.error ?? '', skipped: r.skipped.map((s) => `${s.path}: ${s.reason}`) };
  },
  saveStatus: () => ({ storage: saves?.storageName ?? '…', lastSavedAgo: lastSaved ? (performance.now() - lastSaved) / 1000 : -1 }),
});

render(h(App, {}), document.getElementById('menu')!);

// ---- Boot storage ----
void (async () => {
  try {
    saves = new SaveManager(await pickStorage(), db);
    const r = await saves.load();
    applySettings(r.save.profile.settings);
    if (r.source === 'backup') toast('Your latest save was damaged; loaded the previous one.', 'error', undefined, 7000);
    if (r.skipped.length) toast(`Restored your save. ${r.skipped.length} thing${r.skipped.length === 1 ? '' : 's'} couldn't be restored and were left out.`, 'error', { label: 'Details', run: () => alert(r.skipped.map((s) => `${s.path}: ${s.reason}`).join('\n')) }, 9000);
  } catch (e) {
    toast(`Saving is unavailable in this browser (${(e as Error).message}).`, 'error', undefined, 9000);
  }
  version.value++;
})();

// ---- Loop ----
const menuRoot = document.getElementById('menu')!;
const menuPad = new MenuPad();
installArrowKeys(() => (panel.value ? menuRoot : null));
const NPC_PANELS: Record<string, Panel> = { well: 'well', board: 'board', smith: 'smith', carver: 'carver', skald: 'skald', gate: 'gate', stash: 'stash', trainer: 'trainer' };

// Debug only (?debug=1): the balance bot can drive the session, optionally several ticks a frame.
const auto: Autopilot = { on: false, warp: 1, input: null, upkeep: null };

const loop = startLoop({
  paused: () => !session || panel.value !== null || screen.value !== 'game',
  tick: () => {
    if (!session) return;
    for (let i = 0; i < (auto.on ? auto.warp : 1); i++) {
      const w = session.world;
      const bot = auto.on ? auto.input : null;
      const ev = session.tick(bot ? bot(w) : input.sample(aim));
      playMs += 1000 / 60;
      if (bot && ev.some((e) => e.k === 'waystone' || e.k === 'levelUp')) auto.upkeep?.(w);
      if (ev.length) pendingEvents = pendingEvents.concat(ev);
      // A story beat opens a panel and pauses the game; stop warping into it.
      if (ev.some((e) => e.k === 'story' || e.k === 'interact')) break;
    }
  },
  render: (alpha, dt) => {
    frames++;
    for (const k of input.takeUi()) {
      if (screen.value !== 'game') continue;
      if (k === 'Escape') panel.value = panel.value === 'dialogue' ? 'dialogue' : panel.value ? null : 'pause';
      else if (k === 'KeyI' && !panel.value) panel.value = 'inventory';
      else if (k === 'KeyK' && !panel.value) panel.value = 'skills';
      else if ((k === 'KeyI' || k === 'KeyK') && (panel.value === 'inventory' || panel.value === 'skills')) panel.value = null;
    }
    if (panel.value && menuPad.poll(menuRoot, performance.now()) === 'back') {
      panel.value = panel.value === 'controls' || panel.value === 'settings' ? 'pause' : null;
      if (!panel.value) canvas.focus();
    }
    input.suspended = panel.value !== null;
    if (session) {
      const w = session.world;
      gfx.frame(w, alpha, dt, pendingEvents, 0, db.rooms[w.room.id]?.palette ?? 'hall');
      playEvents(audio, w, pendingEvents, pan);
      eventToasts(w, db, pendingEvents, 0);
      hud.bossEvents(pendingEvents, w, db);
      for (const ev of pendingEvents) {
        if (ev.k === 'interact' && ev.slot === 0 && ev.what === 'npc' && NPC_PANELS[ev.id]) panel.value = NPC_PANELS[ev.id]!;
        if (ev.k === 'interact' && ev.slot === 0 && ev.what === 'waystone' && w.zone.id !== 'citadel') panel.value = 'waystone';
        if (ev.k === 'story') {
          dialogue.value = [...dialogue.value, ev.beat];
          panel.value = 'dialogue';
        }
        // Save points: waystones, and arriving somewhere safe.
        if (ev.k === 'waystone' && ev.slot === 0) void saveNow('waystone');
        if (ev.k === 'exit' && ev.to.endsWith('hub')) setTimeout(() => void saveNow('hub'), 50);
      }
      pendingEvents = [];
      hud.show(screen.value === 'game');
      hud.setHint(w.room.id === 'training' ? SANDBOX_HINT : '');
      const info = gfx.info();
      hud.update(w, db, 0, { fps: loop.stats.fps, simMs: loop.stats.simMs, calls: info.calls, tris: info.triangles });
    } else {
      hud.show(false);
      gfx.renderer.setClearColor(0x0b1016, 1);
      gfx.renderer.clear();
    }
  },
});

installDebug({ db, frames: () => frames, session: () => session, newGame, loop: loop.stats, gfx, saveNow: () => saveNow('debug'), auto });
