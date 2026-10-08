# Architecture

Wyrdsteel is a deterministic simulation with a renderer, a HUD and menus watching it. Everything
that decides an outcome lives in `src/core` and runs the same in Node and in any browser; everything
else only reads it. That split is what makes the game testable without a screen and what will
make co-op possible without a rewrite.

```
input devices ──► PlayerInput frames ──┐
menus ──────────► Commands ────────────┤
                                       ▼
                         step(world, frame, db)   ◄── content packs (JSON, validated)
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        render (three.js)        HUD + menus             audio (Web Audio)
        reads world, events      reads world, events      reads events, mood
```

## The simulation (`src/core`)

- **One mutator.** `step(world, frame, db)` advances the world one tick at 60 Hz. The systems run
  in a fixed order: control, AI, actions, emitters, motion, hits, turrets, projectiles, statuses,
  vitals, deaths, players, encounters, room hazards, cleanup. Room changes happen between ticks,
  inside the sim, so they replay identically.
- **Plain data.** The world is JSON-serialisable structs in arrays. Entities are found by id; no
  integer-keyed object is ever iterated, and ties break by id.
- **Deterministic numbers.** Trig is polynomial (`core/math/trig.ts`) and facing is a unit vector.
  `Math.sin`/`cos`/`pow`/`random`, `**`, `Date`, browser globals and `Map`/`Set` are banned in the
  core by a test that scans the source.
- **Named random streams.** xoshiro128\*\* split into `combat`, `ai`, `level` and one `loot` stream per
  player, so adding a loot roll never shifts how an enemy behaves, and co-op loot is per player.
- **Commands.** Menu actions (equip, craft, allocate a point, travel) are applied between ticks and
  recorded in the replay as interstitials, so a replay includes everything the player did.
- **Replays and hashing.** Inputs are run-length encoded with world-hash checkpoints every few
  seconds. Snapshot and restore are `structuredClone`. A desync names the first tick that differs.

### Combat

Actions are data: windows in milliseconds (converted to ticks at load), hit shapes, poise, launch,
knockback, status build-up, armour and i-frame windows. Melee weapons carry combo graphs. Juggles
decay by 0.8 per hit so they always end. Hit-stop is per entity, never global. Every hit on a
player is capped at a share of max HP (35%; 45% only when the blow was telegraphed at least
900 ms ahead), and pack validation refuses content that breaks those rules.

### Enemies and the boss

An attack-token director limits how many enemies swing at one player at once (2 melee, 3 ranged,
1 heavy; one more melee and one more ranged on Hard). Waiting melee spread over eight slots around the target;
flankers prefer the slots behind it. Navigation is a flow field per room and target tile.

Hrungnir (`core/ai/boss.ts`, tuned in `data/bosses.json`) has three phases with HP floors that no
blow can pass, and an invulnerable two-second transition between them. In phase 1 his guardian
re-plates him on a long, interruptible channel. In phase 2 he observes his target in five-second
spans (time close, time far, dodges), settles on a read, weights the patterns that punish it
fourfold, and never runs a pattern three times in a row. In phase 3 the arena collapses in two
steps while he runs a fixed, learnable sequence.

### Content

Packs in `src/data` are JSON, loaded once into a `ContentDb` with every optional field filled in.
`tests/unit/content` validates references, hit windows, telegraph rules, that every room is
closed and every marker reachable from its entrance, and that skill trees are acyclic. Renamed
ids are mapped in `renames.json` so old saves still load.

## Rendering (`src/render`)

Three.js on WebGL2, physically based. Four presets (`render/quality.ts`), guessed from the GPU's
name and overridable in Settings or with `?quality=`:

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| For | software rendering, old laptops | integrated GPUs | discrete GPUs, Apple silicon | |
| Characters | rigid procedural | skinned, clip-animated | skinned | skinned |
| Rooms | flat colour | PBR texture sets | PBR | PBR, 16× anisotropy |
| Light | sun, sky fill | + sky IBL, 1024 shadow map, 2 point lights | + 2048 shadows, GTAO, 4 point lights | + 4096 shadows, 6 point lights |
| Post | none | bloom, SMAA | + ambient occlusion | same |

- **Rooms** (`level/roomMesh.ts`) are built per room from the tile grid and merged per material:
  textured floors with box-projected UVs, then walls in the zone's style (fitted masonry, snow-laden
  spruce, broken rock with glowing crystal), rubble at the wall foot, and pits with lava or dark
  water at the bottom. Walls between the camera and the player are thinned with an ordered dither,
  and only where they rise above the line of sight to the player's feet. Features that never
  move (conveyor tiles, waystones) are merged per room into one painted and one glowing mesh.
- **Light.** Each zone has its own key light, sky fill, exposure, fog and HDR sky for image-based
  light. The key light's shadow map follows the camera. Braziers, vents, cores, waystones, lava and
  crystal are light sources; the few nearest the player get the preset's point lights, moved each
  frame, so the light count (and so the shader) never changes.
- **Skinned crowds.** Every copy of a model shares one instanced mesh per material kind (painted,
  metal, glowing, each texture set). Each copy is posed through a proxy skeleton that is never
  added to the scene; its bone matrices (times the inverse rest pose) are written into a float
  texture, one row per copy, and the vertex shader skins each vertex by up to four of them. Forty
  thralls cost the same draw calls as one. The same path serves the rigid procedural models: each
  part is a single-bone vertex.
- **Animation** (`anim/animator.ts`). Clips come from a CC0 library on one shared skeleton. The
  sim decides what happens; the view only chooses clips and blends them. Action clips are not
  played at their own pace: an action's progress is mapped onto the clip so that the clip's moment
  of impact lands on the tick the sim deals the hit. Locomotion blends walk, jog and sprint by
  speed with a shared stride phase; aiming and firing replace the upper body while the legs keep
  walking. Weights are kept summing to one per half of the body.
- **Characters** (`models/characters.ts`): the Sworn and the townsfolk are a CC0 hero body under
  clothing (a per-vertex colour and mask baked from the rest pose and laid over the skin texture)
  and plate, helms and weapons built in code and hung on bones. Enemies are a tinted mannequin with
  their kit hung the same way, until generated bodies replace them; then only weapons, shields and
  the parts the sim changes (breakable plates, an exposed heart) stay in code.

### Asset pipeline (`scripts/assets`, run by hand; output committed)

- `fetch-itch.mjs` downloads the free Quaternius packs; `build.mjs` packs ambientCG texture sets,
  downsamples Poly Haven skies, merges and trims the clip libraries onto one skeleton, and reduces
  and re-encodes the bodies.
- `generate.mjs` makes enemy bodies with Meshy's text-to-3D API (T-pose, textured). It reads the
  key from `MESHY_API_KEY`, prints the cost, stops at `--max-credits`, and resumes without paying
  twice. `build.mjs generated` then binds each body to the shared skeleton (`bind.mjs`): scale to
  the mannequin's height, refit the skeleton's arms to the body's span, and give each vertex the
  bone weights of the nearest points on the mannequin's skinned surface. No generator rig and no
  clip retargeting are needed, so every clip plays on every body. Tested on a CC0 body standing in
  for a generated one.
- **Batched effects.** Projectiles, loot gems, loot beams, blob shadows and health bars are each
  one instanced mesh.

Measured in a Foundry fight at the default camera: Low 11–21 draw calls; Medium 136 draw calls and
192k triangles; High 254 and 383k (counting every pass: the shadow map and the ambient-occlusion
normals each draw the scene again). The browser smoke test asserts at most 120 draw calls at Low.

## Interface, audio and platform

- **HUD** is imperative DOM, updated per frame with change detection. **Menus** are Preact with
  signals, navigable by keyboard and gamepad.
- **Audio** is synthesized with Web Audio: event-driven sound effects with voice caps and cooldowns,
  and generated music (drone, chords, melody, bass, war drums) that crossfades between hub,
  exploration, combat and boss moods. No audio files ship.
- **Loop**: fixed-step accumulator on `requestAnimationFrame`, catch-up capped at five ticks.
- **Offline**: a build-time plugin (`scripts/offline.ts`) emits a service worker that precaches every
  built file; the browser tests boot and play with the network off.

## Saves (`src/core/save`)

One versioned JSON document: a profile (stash, settings) and up to three characters. Characters
save at waystones and in the citadel, never mid-fight. Loading is per item: an unknown affix drops
that affix, an unknown base drops that item, and every omission is reported. Versions migrate in a
chain. Storage is IndexedDB, falling back to localStorage, behind an adapter (memory in tests).
Each write rotates two backups; a refused write shows a toast with an **Export now** button.

## Co-op readiness

Play goes through a `Session` interface (`src/game/session.ts`). `SoloSession` applies local input
at once. A lockstep session would exchange `PlayerInput` frames and commands, run the same `step`,
and compare the hash checkpoints the replay system already produces. The world already holds up to
four player slots, loot is per player, and the attack director spreads aggression across players.

## Testing

| Layer | What it checks | Runs |
|---|---|---|
| Unit (Vitest, Node) | Purity, boundaries and IP-guard scans; RNG vectors; damage, caps, statuses, poise, juggles; AI tokens and slots; boss phases, reads and patterns; loot distributions over 100,000 rolls; skills; saves, migration and damaged files; zones, hazards, trials | Every push |
| Golden replays | Committed hash checkpoints for scripted runs: combos, rifle, the Iron Wood opening, the boss's opening; a change that alters an outcome fails until rebaselined on purpose | Every push |
| Balance bot | A tactical, a button-mashing and a kiting policy play through the real input API: boss win rates and fight lengths, per-hit caps, every zone with each class, trials, and the whole chapter from level 1 with no help | Every push |
| Browser (Playwright, SwiftShader) | Boot, new game, keyboard and gamepad movement, combat, loot, gamepad menus, death and respawn, save and reload, the refused-write toast, the draw-call budget; installing and playing offline | Every push; gates deploy |

The boss contract, asserted every push: the tactical bot wins 10 of 10 attempts at the intended
level with found-quality gear, in 3–8 minutes (Berserker about 6.5, Commando about 3.5); holding
attack wins none; no hit exceeds its cap (the largest seen is about 26% of max HP).

## Known trade-offs

| Trade-off | Why it's acceptable now | When to revisit |
|---|---|---|
| Polynomial trig and banned float APIs in the core | Bit-identical results on every browser, which co-op lockstep requires; the error is far below anything a player can see | If profiling ever shows the trig helpers as hot, or a platform needs native precision |
| Fixed 60 Hz step; catch-up capped at five ticks | Replays, golden tests and the bot all run the step the player does; a long stall slows time instead of skipping it | If a target device can't hold 60 steps a second; the step costs ~0.7 ms with 40 enemies, so far from it |
| CC0 bodies and clips, armour built in code | A large step up from boxes with no licensing risk, and every body shares one skeleton and one set of clips | When generated or commissioned character models arrive: they replace the bodies only, provided they are rigged to the same skeleton |
| Art downloaded on demand, not precached | The initial download stays small, and Low (software rendering) never fetches it; what a player has seen is cached for offline play | If players report missing art offline: precache the current zone's sets when its waystone is reached |
| Draw calls above 120 at High | High is for discrete GPUs, where the extra shadow and ambient-occlusion passes cost little; Low keeps the old budget and the smoke test asserts it | If a High-preset GPU misses 60 fps: merge the static room meshes across materials with an atlas |
| Bone matrices in a float texture for instancing | Draw calls stay flat as crowds grow | On a three.js upgrade that changes the shader chunks it patches; the smoke test's draw-call assertion and screenshots are the alarm |
| Balance verified by a bot, not by people | Every balance claim is tested on every push, so regressions show the same day | When real players arrive: the bot reads telegraphs perfectly, so human win rates will be lower and the boss may want softening |
| Boss counters read broad habits (close, far, dodgy) | Readable adaptation a player can notice and answer, which was the point | If players learn to game the reads; a finer read (which attacks you dodge) fits the same seam |
| Saves only at waystones and in the citadel | No mid-fight state to serialise, and no save-scumming a boss | If sessions on phones get short enough that losing a room hurts |
| Local-only saves | No accounts and no server; export and import cover backups and moving machines | If players ask for cross-device play often enough to justify a sync service |
| Service worker precaches the whole build | Offline play and instant later loads | If the download grows past a few MB, when lazy chunks would be cached on first use instead |
| Two of five classes; no co-op yet | A complete, tested chapter came first, and the `Session` seam keeps co-op an addition, not a rewrite | Next phase: lockstep co-op over WebRTC, then Defender |
