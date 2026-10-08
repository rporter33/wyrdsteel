# Wyrdsteel

A browser action RPG set at the end of an age-long winter, where the gods of the north are
soldiers rebuilt by machine. It is a spiritual successor to *Too Human* (Xbox 360, 2008): it keeps
that game's premise, loot and class depth, and sets out to fix what its critics faulted.

**Play:** https://rporter33.github.io/wyrdsteel/ (desktop browser; keyboard and mouse or a gamepad)

- One full chapter: the citadel of Gladsheim, three zones, a three-phase boss and an ending.
- Two classes (Berserker and Commando), each with three skill paths, plus a Human or Cyber aspect
  tree you can swap at Idunn's Well.
- Diablo-style loot: five rarities, prefix and suffix affixes, sockets and runes, crafting.
- Wyrd Trials after the chapter: seeded remixes of each zone, ten tiers deep.
- Graphics presets from Low (software rendering, old laptops) to Ultra: physically based
  materials, shadow maps, ambient occlusion, bloom, point lights from fires and lava, and skinned
  characters animated from a clip library. Settings → Graphics, or `?quality=low|medium|high|ultra`.
- Saves stay in your browser; works offline after the first visit. No accounts, no server, no
  analytics. All art is CC0 (see [CREDITS.md](CREDITS.md)); sound and music are synthesized.

## What it fixes

| *Too Human*, as reviewed | Wyrdsteel |
|---|---|
| Melee on the right stick slid you toward the nearest enemy | Separate light, heavy, launcher and dodge buttons; melee goes where you aim, with a soft-target assist you can set from 0 to 100% and a hard lock that overrides it |
| Ranged auto-lock | Free aim with mouse or right stick; no aim magnetism on mouse |
| Awkward camera | Fixed 3/4 camera that never takes control; walls in the way fade out |
| A 30-second unskippable death scene; enemies respawned | A 2.5 s Valkyrie, skippable after 0.3 s; cleared rooms stay cleared; death costs 10% of the bounty earned since the waystone, and you can win it back |
| Bosses one-shot you | Per-hit damage caps (35% of max HP; 45% only for blows warned at least 900 ms ahead), enforced by pack validation and checked by a bot |
| Bosses tougher, not smarter | Hrungnir reads how you fight (hugging, kiting, dodging) and answers with patterns that punish it |
| Cyberspace interludes | Optional Wells of Wyrd: short combat rooms with one rule each |
| Seeing the other aspect took a whole second playthrough | Aspect swap at the Well, with separate skill points for each aspect |

## Controls

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move / aim | WASD / mouse | Left stick / right stick |
| Light, heavy, launcher | Left mouse, E, Q | X, Y, B |
| Fire / precision aim | Right mouse / Shift | RT / LT |
| Dodge | Space | A |
| Abilities, Ruiner | 1–4, R | LB + face buttons, LB + RB |
| Interact, finisher | F | RB |
| Lock on | Tab | R3 |
| Character, skills, pause | I, K, Esc | View, Menu |

Every key can be rebound in Settings. Settings also hold aim assist, difficulty, camera distance
and pitch, screen shake, hit flashes, reduced motion, text size, bold telegraphs and volume.

## Develop

```sh
npm install
npm run dev        # local dev server
npm run check      # typecheck, unit tests, balance bot, build, size budget, browser tests
npm run balance    # the bot plays boss fights, zones, trials and the whole chapter
```

The browser tests use Playwright's Chromium (in CI: `npx playwright install --with-deps chromium`).
Add `?debug=1` to the URL for `window.__game`, the hook the browser tests drive; `?perf=1` shows
frame time, sim time and draw calls.

How it is built, how it is tested, and what it gave up: [ARCHITECTURE.md](ARCHITECTURE.md).

## Layout

| Folder | What lives there |
|---|---|
| `src/core/` | The game rules: a deterministic simulation with no rendering, DOM or clock access. Unit-tested in Node. |
| `src/data/` | Content packs (classes, enemies, items, rooms, zones, story, the boss) as JSON. |
| `src/render/` | Three.js scene: textured rooms, skinned characters, effects, post-processing, quality presets. Reads sim state; never changes it. |
| `src/audio/` | Synthesized sound effects and generated music. |
| `src/platform/` | The fixed-step loop, input devices and storage. |
| `src/ui/` | HUD and menus. |
| `src/game/` | Wires the pieces together; the debug hook. |
| `tests/` | Unit tests, golden replays, the balance bot, browser tests. |
| `scripts/assets/` | Fetches the CC0 sources and builds `public/assets/` (textures, skies, characters, clips). Run by hand; the output is committed. |

## Legal

Unofficial fan work. Not affiliated with or endorsed by Microsoft or Silicon Knights. *Too Human*
is a trademark of its owner, named here only to describe the inspiration. No names, levels,
enemy designs or text from it are used. MIT licensed.
