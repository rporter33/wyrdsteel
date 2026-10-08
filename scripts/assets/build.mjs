// Builds public/assets from public-domain (CC0) sources. Run by hand when the art changes:
//   node scripts/assets/build.mjs [materials|env|characters]...
// The output is committed and CI never runs this. Sources, all CC0:
//   - ambientCG materials, fetched by id (https://ambientcg.com)
//   - Poly Haven HDR skies, fetched by name (https://polyhaven.com)
//   - Quaternius Universal Animation Library 1 and 2 and Universal Base Characters, read from
//     .asset-cache/quaternius (fetch them with scripts/assets/fetch-itch.mjs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress, mergeDocuments, unpartition, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { bindToSkeleton } from './bind.mjs';

const CACHE = '.asset-cache';
const OUT = 'public/assets';
const SIZE = 1024;

/** Game name -> ambientCG id. Tiling (metres per repeat) is decided in the renderer. */
export const MATERIALS = {
  slabs: 'PavingStones128',
  masonry: 'Bricks075A',
  snow: 'Snow014',
  snowsoft: 'Snow006',
  bark: 'Bark001',
  rock: 'Rock030',
  plates: 'MetalPlates006',
  rust: 'Metal041B',
  walkway: 'MetalWalkway014',
  lava: 'Lava001',
  ice: 'Ice003',
  crystal: 'Ice002',
  dirt: 'Ground112',
};

/** Palette -> Poly Haven HDRI, used for image-based lighting (never seen directly). */
export const SKIES = {
  hall: 'old_hall',
  wood: 'snowy_forest_path_01',
  foundry: 'industrial_workshop_foundry',
  roots: 'small_cave',
  wyrd: 'rogland_moonlit_night',
};

/** Animation clips the game uses, from the two libraries. Everything else is dropped. */
export const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Roll', 'Sword_Idle', 'Sword_Attack',
  'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Regular_Combo', 'Sword_Heavy_Combo',
  'Sword_Dash', 'Sword_Block', 'Punch_Jab', 'Punch_Cross', 'Melee_Hook', 'Pistol_Idle_Loop',
  'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Spell_Simple_Enter', 'Spell_Simple_Shoot',
  'Spell_Simple_Idle_Loop', 'OverhandThrow', 'Hit_Chest', 'Hit_Head', 'Hit_Knockback', 'Death01',
  'Jump_Start', 'Jump_Loop', 'Jump_Land', 'NinjaJump_Start', 'NinjaJump_Land', 'Interact', 'Consume',
  'Zombie_Idle_Loop', 'Zombie_Walk_Fwd_Loop', 'Zombie_Scratch', 'Shield_Dash', 'Shield_OneShot',
  'Idle_Shield_Loop', 'Idle_Shield_Break', 'LayToIdle', 'Idle_FoldArms_Loop', 'Idle_Talking_Loop',
  'Idle_No_Loop', 'Yes', 'Chest_Open', 'Crouch_Idle_Loop',
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

async function download(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

function findFile(dir, suffix) {
  for (const f of readdirSync(dir, { recursive: true })) if (String(f).endsWith(suffix)) return join(dir, String(f));
  return null;
}

async function grey(file, size) {
  return sharp(file).resize(size, size).greyscale().raw().toBuffer();
}

/** Colour, normal (OpenGL convention, as three.js expects) and ORM (AO, roughness, metalness). */
async function materials() {
  for (const [name, id] of Object.entries(MATERIALS)) {
    const zip = join(CACHE, 'ambientcg', `${id}_1K-JPG.zip`);
    const dir = join(CACHE, 'ambientcg', id);
    mkdirSync(join(CACHE, 'ambientcg'), { recursive: true });
    await download(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, zip);
    if (!existsSync(dir)) sh('unzip', ['-q', '-o', zip, '-d', dir]);
    const out = join(OUT, 'materials', name);
    mkdirSync(out, { recursive: true });
    const color = findFile(dir, '_Color.jpg');
    const normal = findFile(dir, '_NormalGL.jpg');
    if (!color || !normal) throw new Error(`${id}: missing colour or normal map`);
    await sharp(color).resize(SIZE, SIZE).webp({ quality: 80 }).toFile(join(out, 'color.webp'));
    await sharp(normal).resize(SIZE, SIZE).webp({ quality: 90 }).toFile(join(out, 'normal.webp'));
    const ao = findFile(dir, '_AmbientOcclusion.jpg');
    const rough = findFile(dir, '_Roughness.jpg');
    const metal = findFile(dir, '_Metalness.jpg');
    const n = SIZE * SIZE;
    const [a, r, m] = await Promise.all([ao ? grey(ao, SIZE) : null, rough ? grey(rough, SIZE) : null, metal ? grey(metal, SIZE) : null]);
    const orm = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) {
      orm[i * 3] = a ? a[i] : 255;
      orm[i * 3 + 1] = r ? r[i] : 200;
      orm[i * 3 + 2] = m ? m[i] : 0;
    }
    await sharp(orm, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 88 }).toFile(join(out, 'orm.webp'));
    const emission = findFile(dir, '_Emission.jpg');
    if (emission) await sharp(emission).resize(SIZE, SIZE).webp({ quality: 80 }).toFile(join(out, 'emissive.webp'));
    console.log('material', name, id);
  }
}

// ---- HDR skies: decode Radiance RGBE, halve to 512x256, write flat RGBE (three's HDRLoader reads it).

function readRgbe(buf) {
  let i = 0;
  const line = () => {
    let s = '';
    while (buf[i] !== 0x0a) s += String.fromCharCode(buf[i++]);
    i++;
    return s;
  };
  let l;
  while ((l = line()) !== '');
  const [, h, , w] = line().split(' ').map((x, k) => (k % 2 ? Number(x) : x));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (buf[i] !== 2 || buf[i + 1] !== 2) throw new Error('only RLE scanlines supported');
    i += 4;
    const row = new Uint8Array(w * 4);
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let count = buf[i++];
        if (count > 128) {
          count -= 128;
          const v = buf[i++];
          while (count--) row[(x++) * 4 + c] = v;
        } else while (count--) row[(x++) * 4 + c] = buf[i++];
      }
    }
    data.set(row, y * w * 4);
  }
  return { w, h, data };
}

function toFloat(r, g, b, e) {
  if (!e) return [0, 0, 0];
  const f = 2 ** (e - 136);
  return [(r + 0.5) * f, (g + 0.5) * f, (b + 0.5) * f];
}

function toRgbe(r, g, b) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(v) + 1e-9);
  const f = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * f)), Math.min(255, Math.floor(g * f)), Math.min(255, Math.floor(b * f)), e + 128];
}

async function skies() {
  mkdirSync(join(CACHE, 'polyhaven'), { recursive: true });
  mkdirSync(join(OUT, 'env'), { recursive: true });
  for (const [zone, name] of Object.entries(SKIES)) {
    const src = join(CACHE, 'polyhaven', `${name}_1k.hdr`);
    await download(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${name}_1k.hdr`, src);
    const { w, h, data } = readRgbe(readFileSync(src));
    const W = w / 2;
    const H = h / 2;
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = ((y * 2 + dy) * w + x * 2 + dx) * 4;
          const f = toFloat(data[k], data[k + 1], data[k + 2], data[k + 3]);
          r += f[0] / 4;
          g += f[1] / 4;
          b += f[2] / 4;
        }
        out.set(toRgbe(r, g, b), (y * W + x) * 4);
      }
    }
    const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
    writeFileSync(join(OUT, 'env', `${zone}.hdr`), Buffer.concat([header, Buffer.from(out)]));
    console.log('sky', zone, name, `${W}x${H}`);
  }
}

// ---- Characters and animation.

function unzipPack(file) {
  const dir = join(CACHE, 'quaternius', basename(file, '.zip').replace(/[^A-Za-z0-9]/g, ''));
  if (!existsSync(dir)) sh('unzip', ['-q', '-o', file, '-d', dir]);
  return dir;
}

/**
 * Remove an animation with its channels and samplers. Keyframe data can be shared between clips,
 * so it is left for prune() to drop once nothing references it.
 */
function dropAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const smp of a.listSamplers()) smp.dispose();
  a.dispose();
}

const FINGER = /^(index|middle|pinky|ring|thumb)_/;

/**
 * Both libraries ship their own copy of the same skeleton. Point every clip at the first copy's
 * bones (matched by name) and drop the second, or half the clips would animate nothing.
 */
function unifySkeletons(doc) {
  const first = new Map();
  for (const n of doc.getRoot().listNodes()) if (!first.has(n.getName())) first.set(n.getName(), n);
  for (const a of doc.getRoot().listAnimations())
    for (const c of a.listChannels()) {
      const t = c.getTargetNode();
      const k = t && first.get(t.getName());
      if (k && k !== t) c.setTargetNode(k);
    }
  for (const n of doc.getRoot().listNodes()) if (first.get(n.getName()) !== n) n.dispose();
}

/**
 * Keep what the game camera can see: bone rotations, and translation only on the root and pelvis.
 * Fingers come out of every clip; one 'Grip' clip holds them as Sword_Idle does, set once.
 */
function trimChannels(doc) {
  const root = doc.getRoot();
  const buf = root.listBuffers()[0];
  const idle = root.listAnimations().find((a) => a.getName() === 'Sword_Idle');
  const grip = doc.createAnimation('Grip');
  const t0 = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0])).setBuffer(buf);
  for (const c of idle.listChannels()) {
    const n = c.getTargetNode();
    if (c.getTargetPath() !== 'rotation' || !FINGER.test(n.getName())) continue;
    const v = c.getSampler().getOutput().getElement(0, []);
    const out = doc.createAccessor().setType('VEC4').setArray(new Float32Array(v)).setBuffer(buf);
    const smp = doc.createAnimationSampler().setInput(t0).setOutput(out).setInterpolation('LINEAR');
    grip.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath('rotation').setSampler(smp));
  }
  for (const a of root.listAnimations()) {
    if (a === grip) continue;
    for (const c of a.listChannels()) {
      const name = c.getTargetNode().getName();
      const path = c.getTargetPath();
      const keep = path === 'rotation' ? !FINGER.test(name) : path === 'translation' && (name === 'pelvis' || name === 'root');
      if (keep) continue;
      const smp = c.getSampler();
      c.dispose();
      smp.dispose();
    }
  }
}

async function write(doc, file) {
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  console.log('wrote', file, `${(statSync(file).size / 1024).toFixed(0)} KB`);
}

/** The base-character glTFs name a few textures that ship under a slightly different name. */
function fixImagePaths(src) {
  const dir = src.slice(0, src.lastIndexOf('/'));
  const json = JSON.parse(readFileSync(src, 'utf8'));
  for (const img of json.images ?? []) {
    if (!img.uri || existsSync(join(dir, decodeURIComponent(img.uri)))) continue;
    const alt = decodeURIComponent(img.uri).replace('_png.png', '.png');
    if (existsSync(join(dir, alt))) img.uri = alt;
  }
  const fixed = src.replace('.gltf', '.fixed.gltf');
  writeFileSync(fixed, JSON.stringify(json));
  return fixed;
}

async function characters() {
  const q = join(CACHE, 'quaternius');
  if (!existsSync(q)) throw new Error('fetch the Quaternius packs first (scripts/assets/fetch-itch.mjs)');
  const zips = readdirSync(q).filter((f) => f.endsWith('.zip'));
  const dirs = zips.map((z) => unzipPack(join(q, z)));
  const ual1 = dirs.map((d) => findFile(d, 'UAL1_Standard.glb')).find(Boolean);
  const ual2 = dirs.map((d) => findFile(d, 'UAL2_Standard.glb')).find(Boolean);
  if (!ual1 || !ual2) throw new Error('animation libraries not found');
  mkdirSync(join(OUT, 'characters'), { recursive: true });

  // The mannequin body (enemies until their own models arrive), with no animation, cut to about
  // a fifth of its triangles: forty of them share the screen at 80 pixels tall.
  const body = await io.read(ual2);
  for (const a of body.getRoot().listAnimations()) dropAnimation(a);
  await body.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.2, error: 0.004 }));
  await write(body, join(OUT, 'characters', 'mannequin.glb'));

  // One animation file: the clips we use from both libraries, no meshes.
  const anims = await io.read(ual1);
  mergeDocuments(anims, await io.read(ual2));
  await anims.transform(unpartition());
  unifySkeletons(anims);
  for (const a of anims.getRoot().listAnimations()) if (!CLIPS.includes(a.getName())) dropAnimation(a);
  for (const n of anims.getRoot().listNodes()) n.setMesh(null).setSkin(null);
  for (const m of anims.getRoot().listMeshes()) m.dispose();
  for (const s of anims.getRoot().listSkins()) s.dispose();
  // Keep one copy of each clip (both files ship the T-pose, for instance).
  const seen = new Set();
  for (const a of anims.getRoot().listAnimations()) {
    if (seen.has(a.getName())) dropAnimation(a);
    else seen.add(a.getName());
  }
  trimChannels(anims);
  await anims.transform(resample({ tolerance: 1e-4 }));
  await write(anims, join(OUT, 'characters', 'anims.glb'));

  // The Sworn: the base hero bodies, textures as WebP.
  for (const sex of ['Male', 'Female']) {
    const src = dirs.map((d) => findFile(d, `Superhero_${sex}_FullBody.gltf`)).find(Boolean);
    if (!src) throw new Error(`Superhero_${sex} not found`);
    const doc = await io.read(fixImagePaths(src));
    // Half the triangles: the body is under 200 pixels tall even in close-ups, and the citadel has nine.
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.002 }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }));
    await write(doc, join(OUT, 'characters', `sworn-${sex.toLowerCase()}.glb`));
  }
}

/** The skinned mannequin whose skeleton every character shares, from the animation library. */
function referenceBody() {
  const q = join(CACHE, 'quaternius');
  const dirs = readdirSync(q).filter((f) => f.endsWith('.zip')).map((z) => unzipPack(join(q, z)));
  const ref = dirs.map((d) => findFile(d, 'UAL2_Standard.glb')).find(Boolean);
  if (!ref) throw new Error('animation library not found; fetch the Quaternius packs first');
  return ref;
}

/** Bind one T-posed character to the shared skeleton, trim it for the crowd, and write it. */
async function bindOne(src, out, ratio = 0.5) {
  const ref = await io.read(referenceBody());
  const gen = await io.read(src.endsWith('.gltf') ? fixImagePaths(src) : src);
  bindToSkeleton(ref, gen);
  await ref.transform(
    unpartition(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }),
  );
  await write(ref, out);
}

/**
 * Generated characters (from generate.mjs, cached in .asset-cache/generated/<kind>.glb) bound to
 * the shared skeleton, plus a manifest the game reads to know which enemies have one.
 */
async function generated() {
  const dir = join(CACHE, 'generated');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.glb')) : [];
  if (!files.length) throw new Error('no generated models in .asset-cache/generated; run scripts/assets/generate.mjs');
  mkdirSync(join(OUT, 'characters'), { recursive: true });
  const manifest = {};
  for (const f of files) {
    const kind = basename(f, '.glb');
    console.log(`binding ${kind}`);
    await bindOne(join(dir, f), join(OUT, 'characters', `gen-${kind}.glb`));
    manifest[kind] = `gen-${kind}.glb`;
  }
  writeFileSync(join(OUT, 'characters', 'generated.json'), JSON.stringify(manifest, null, 2) + '\n');
}

const which = process.argv.slice(2);
if (which[0] === 'bind') {
  // node scripts/assets/build.mjs bind <in.glb|.gltf> <out.glb>: test the binder on any T-posed body.
  await bindOne(which[1], which[2]);
  process.exit(0);
}
const all = !which.length;
if (all || which.includes('materials')) await materials();
if (all || which.includes('env')) await skies();
if (all || which.includes('characters')) await characters();
if (which.includes('generated')) await generated();
