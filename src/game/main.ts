import { render, h } from 'preact';
import { loadContent } from '../core/data/load';
import { packs } from '../data';
import { GameRenderer } from '../render/scene';
import { InputSampler } from '../platform/input/sampler';
import { startLoop } from '../platform/loop';
import { SoloSession } from './session';
import { App } from '../ui/menus/App';
import { Hud } from '../ui/hud/hud';
import { setApi } from '../ui/api';
import { panel, screen, version } from '../ui/store';
import type { SimEvent } from '../core/sim/types';
import { installDebug } from './debug';

const params = new URLSearchParams(location.search);
const db = loadContent(packs);
const canvas = document.getElementById('view') as HTMLCanvasElement;
canvas.tabIndex = 0;
const gfx = new GameRenderer(canvas, db);
gfx.opts.lowFx = params.has('lowfx');
const input = new InputSampler(canvas);
const hud = new Hud(document.getElementById('hud')!);
hud.showPerf = params.has('perf');

let session: SoloSession | null = null;
let pendingEvents: SimEvent[] = [];
let frames = 0;
let mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, inside: true };
});

function playerPos() {
  const w = session?.world;
  if (!w) return null;
  const e = w.entities.find((x) => x.id === w.players[0]?.entity);
  return e ? { x: e.x, z: e.z } : null;
}

const aim = {
  cursorWorld: () => (mouse.inside ? gfx.rig.pointToWorld(mouse.x, mouse.y) : null),
  playerPos,
  parkTarget: () => {
    const w = session?.world;
    const e = w?.entities.find((x) => x.id === w.players[0]?.entity);
    const t = e?.pl ? w!.entities.find((x) => x.id === (e.pl!.lock || e.pl!.soft)) : null;
    return t ? { x: t.x, z: t.z } : null;
  },
};

function newGame(name: string, cls: string): void {
  const seed = params.has('seed') ? hashSeed(params.get('seed')!) : (Math.random() * 2 ** 32) >>> 0;
  session = new SoloSession({ seed, players: [{ name, cls }], zone: 'training', node: 'training' }, db);
  gfx.invalidate();
  screen.value = 'game';
  panel.value = null;
  canvas.focus();
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
  },
});

render(h(App, {}), document.getElementById('menu')!);

const loop = startLoop({
  paused: () => !session || panel.value !== null || screen.value !== 'game',
  tick: () => {
    if (!session) return;
    const ev = session.tick(input.sample(aim));
    if (ev.length) pendingEvents = pendingEvents.concat(ev);
  },
  render: (alpha, dt) => {
    frames++;
    for (const k of input.takeUi()) {
      if (screen.value !== 'game') continue;
      if (k === 'Escape') panel.value = panel.value ? null : 'pause';
    }
    input.suspended = panel.value !== null;
    if (session) {
      gfx.frame(session.world, alpha, dt, pendingEvents, 0, 'hall');
      pendingEvents = [];
      hud.show(screen.value === 'game');
      const info = gfx.info();
      hud.update(session.world, db, 0, { fps: loop.stats.fps, simMs: loop.stats.simMs, calls: info.calls, tris: info.triangles });
    } else {
      hud.show(false);
      gfx.renderer.setClearColor(0x0b1016, 1);
      gfx.renderer.clear();
    }
  },
});

installDebug({
  db,
  frames: () => frames,
  session: () => session,
  newGame,
  loop: loop.stats,
  gfx,
});
