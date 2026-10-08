# Wyrdsteel

A browser action RPG set at the end of an age-long winter, where the gods of the north are
soldiers rebuilt by machine. It is a spiritual successor to *Too Human* (Xbox 360, 2008): it keeps
that game's premise, loot and class depth, and sets out to fix what its critics faulted.

**Status:** in development (milestone M0: scaffold and deploy).

- Runs in the browser. Keyboard and mouse or a gamepad.
- Saves stay in your browser. No accounts, no server, no analytics.
- No third-party assets. See [CREDITS.md](CREDITS.md).

## Develop

```sh
npm install
npm run dev        # local dev server
npm run check      # typecheck, unit tests, build, size budget, browser smoke test
```

The browser smoke test uses Playwright's Chromium. In CI it is installed with
`npx playwright install --with-deps chromium`.

## Layout

| Folder | What lives there |
|---|---|
| `src/core/` | The game rules: a deterministic simulation with no rendering, DOM or clock access. Unit-tested in Node. |
| `src/data/` | Content packs (classes, enemies, items, rooms) as JSON. |
| `src/render/` | Three.js scene, procedural models and effects. Reads sim state; never changes it. |
| `src/platform/` | The fixed-step loop, input devices and storage. |
| `src/ui/` | HUD and menus. |
| `src/game/` | Wires the pieces together. |

## Legal

Unofficial fan work. Not affiliated with or endorsed by Microsoft or Silicon Knights. *Too Human*
is a trademark of its owner, named here only to describe the inspiration. MIT licensed.
