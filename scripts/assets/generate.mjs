// Generates the enemy characters with Meshy's text-to-3D API, in T-pose and textured, into
// .asset-cache/generated/<kind>.glb. `node scripts/assets/build.mjs generated` then binds each to
// the game's skeleton and writes public/assets/characters/gen-<kind>.glb plus a manifest.
//
//   MESHY_API_KEY=... node scripts/assets/generate.mjs [--dry-run] [--only thrall,troll]
//                                                       [--max-credits 250] [--model latest|meshy-6|meshy-t2]
//
// The key is read from the environment and never printed. Before spending anything the script
// reads the balance, prints what each model costs, and stops if the run would pass --max-credits.
// Finished task ids are kept in .asset-cache/generated/tasks.json, so a rerun resumes rather than
// paying twice.
//
// Licence: per Meshy's pricing and help pages at the time of writing, output made on a paid plan
// (which API access requires) is owned by the account holder, while free-plan output is CC BY 4.0
// and must credit Meshy. Their terms also let them train on what is generated. Check the current
// terms, and add the generated bodies to CREDITS.md either way.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.meshy.ai/openapi';
const OUT = '.asset-cache/generated';
const TASKS = join(OUT, 'tasks.json');

/** House style, shared by every prompt so the cast belongs together. */
const STYLE =
  'stylized realistic game character for a Norse science-fiction action RPG, full body, standing in a T-pose with arms straight out to the sides, empty open hands, no weapon, no shield, no base or pedestal, centred, facing forward';
const TEXTURE = 'hand-painted PBR game textures, worn and weathered, readable from a top-down camera, muted palette with a few strong accent colours';

/** One entry per enemy body. Weapons, shields and gameplay parts stay in code, on the bones. */
const CAST = [
  { kind: 'thrall', polys: 6000, prompt: 'a gaunt, hunched cyborg ghoul of scavenged scrap iron and frostbitten leather, riveted iron face mask with two red eye slits, bone claws on its fingers, ragged hide loincloth' },
  { kind: 'spiker', polys: 6000, prompt: 'a lean hooded marksman in a dark olive cloak over studded leather armour with brass buckles, face hidden in the hood except two yellow glowing eyes, a quiver of iron spikes on the back' },
  { kind: 'bulwark', polys: 7000, prompt: 'a broad heavy infantryman in dented grey steel plate armour and chainmail, closed helmet with two curved bone horns, red glowing eyes behind the visor' },
  { kind: 'frostwright', polys: 7000, prompt: 'an ice sorcerer in flowing pale blue robes with frost embroidery, a crown of jagged ice crystals, frost-white skin, glowing cyan eyes' },
  { kind: 'mender', polys: 6000, prompt: 'a small hooded healer in moss-green robes bound with leather straps, faintly glowing green runes stitched into the robe, wooden charms at the belt' },
  { kind: 'troll', polys: 9000, prompt: 'a hulking frost troll with grey-green skin, massive shoulders and long arms, short tusks and small horns, iron plates strapped to its shoulders and shins, grenade canisters on its back' },
  { kind: 'jotun', polys: 12000, prompt: 'a colossal stone giant war machine, body of carved grey granite blocks bound with iron bands and rivets, a horned stone head with ember-orange eyes, a glowing forge furnace in its chest' },
  { kind: 'golem', polys: 9000, prompt: 'a lumbering giant of cracked brown clay with crude handprints pressed into it, heavy shoulders, a small glowing golden heart in its chest' },
];

const COST = { preview: { latest: 20, 'meshy-6': 20, 'meshy-7.1': 20, 'meshy-6-lite': 5, 'meshy-t2': 5 }, refine: 10 };

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const dry = flag('dry-run');
const only = opt('only', '')?.split(',').filter(Boolean);
const cap = Number(opt('max-credits', '250'));
const model = opt('model', 'latest');

const key = process.env.MESHY_API_KEY;
if (!key && !dry) {
  console.error('MESHY_API_KEY is not set. Add it to the environment (it is never printed), or pass --dry-run to see the plan.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a task until it finishes; returns the task. */
async function wait(id, label) {
  const start = Date.now();
  let last = -1;
  for (;;) {
    const t = await call('GET', `/v2/text-to-3d/${id}`);
    if (t.progress !== last) {
      console.log(`  ${label}: ${t.status} ${t.progress ?? 0}%`);
      last = t.progress;
    }
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label} ${t.status}: ${t.task_error?.message ?? 'no reason given'}`);
    if (Date.now() - start > 30 * 60_000) throw new Error(`${label}: still not done after 30 minutes (task ${id})`);
    await sleep(10_000);
  }
}

mkdirSync(OUT, { recursive: true });
const tasks = existsSync(TASKS) ? JSON.parse(readFileSync(TASKS, 'utf8')) : {};
const save = () => writeFileSync(TASKS, JSON.stringify(tasks, null, 2) + '\n');
const cast = CAST.filter((c) => !only?.length || only.includes(c.kind));

// The plan: what is left to pay for, given what earlier runs finished.
const perPreview = COST.preview[model] ?? 20;
let estimate = 0;
for (const c of cast) {
  const t = tasks[c.kind] ?? {};
  const need = (t.preview ? 0 : perPreview) + (t.refine ? 0 : COST.refine);
  estimate += existsSync(join(OUT, `${c.kind}.glb`)) ? 0 : need;
  console.log(`${c.kind.padEnd(12)} ${existsSync(join(OUT, `${c.kind}.glb`)) ? 'done' : `${need} credits`}`);
}
console.log(`Estimated cost: ${estimate} credits (preview ${perPreview} + texture ${COST.refine} per model, model "${model}"); cap ${cap}.`);
if (dry) process.exit(0);
const { balance } = await call('GET', '/v1/balance');
console.log(`Balance: ${balance} credits.`);
if (estimate > cap) {
  console.error(`Stopping: the run would cost more than --max-credits ${cap}.`);
  process.exit(1);
}
if (estimate > balance) {
  console.error('Stopping: not enough credits for the whole run. Use --only to generate a few.');
  process.exit(1);
}

for (const c of cast) {
  const file = join(OUT, `${c.kind}.glb`);
  if (existsSync(file)) continue;
  const t = (tasks[c.kind] ??= {});
  console.log(`${c.kind}:`);
  if (!t.preview) {
    const r = await call('POST', '/v2/text-to-3d', {
      mode: 'preview',
      prompt: `${c.prompt}. ${STYLE}`.slice(0, 800),
      ai_model: model,
      pose_mode: 't-pose',
      should_remesh: true,
      topology: 'triangle',
      target_polycount: c.polys,
      target_formats: ['glb'],
    });
    t.preview = r.result;
    save();
  }
  await wait(t.preview, 'shape');
  if (!t.refine) {
    const r = await call('POST', '/v2/text-to-3d', { mode: 'refine', preview_task_id: t.preview, enable_pbr: true, texture_prompt: `${c.prompt}. ${TEXTURE}`.slice(0, 800), texture_resolution: '2k', target_formats: ['glb'] });
    t.refine = r.result;
    save();
  }
  const done = await wait(t.refine, 'texture');
  const url = done.model_urls?.glb;
  if (!url) throw new Error(`${c.kind}: the finished task has no GLB`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${c.kind}: download failed, HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  t.credits = (t.credits ?? 0) + (done.consumed_credits ?? 0);
  save();
  console.log(`  saved ${file}`);
}
console.log('Done. Next: node scripts/assets/build.mjs generated');
