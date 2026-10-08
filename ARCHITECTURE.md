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

Three.js, WebGL2 only, low-poly procedural models with toon shading. Budget: 60 fps on a mid-range
integrated GPU at 1080p, at most 120 draw calls and 250k triangles, with 40 enemies on screen.

- **Instanced crowds.** Every copy of a model shares one instanced mesh (two if it has glowing
  parts). Each copy is posed through a proxy skeleton that is never added to the scene; its pivot
  matrices are written into a float texture, and the vertex shader moves each vertex by its pivot's
  matrix. Forty thralls cost the same draw calls as one. Players go through the same path.
- **Baked statics.** Room features that never move (conveyor tiles, waystones, NPCs) are merged
  per room into one lit mesh and one glowing mesh.
- **Batched effects.** Projectiles, loot gems, loot beams, shadows and health bars are each one
  instanced mesh.

Measured in the busiest rooms: 9–23 draw calls and about 21k triangles. The browser smoke test
asserts the draw-call budget during a fight.

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
| Procedural low-poly art, rigid-part animation, no skeletons | No licensing questions, a small download, and every model instances the same way | If an artist joins: a glTF pipeline would replace `src/render/models`, and the instancing would need skinning |
| Pivot matrices in a float texture for instancing | Draw calls stay flat as crowds grow (9–23 in the busiest rooms, against a budget of 120) | On a three.js upgrade that changes the shader chunks it patches; the smoke test's draw-call assertion and screenshots are the alarm |
| Balance verified by a bot, not by people | Every balance claim is tested on every push, so regressions show the same day | When real players arrive: the bot reads telegraphs perfectly, so human win rates will be lower and the boss may want softening |
| Boss counters read broad habits (close, far, dodgy) | Readable adaptation a player can notice and answer, which was the point | If players learn to game the reads; a finer read (which attacks you dodge) fits the same seam |
| Saves only at waystones and in the citadel | No mid-fight state to serialise, and no save-scumming a boss | If sessions on phones get short enough that losing a room hurts |
| Local-only saves | No accounts and no server; export and import cover backups and moving machines | If players ask for cross-device play often enough to justify a sync service |
| Service worker precaches the whole build | Offline play and instant later loads | If the download grows past a few MB, when lazy chunks would be cached on first use instead |
| Two of five classes; no co-op yet | A complete, tested chapter came first, and the `Session` seam keeps co-op an addition, not a rewrite | Next phase: lockstep co-op over WebRTC, then Defender |
