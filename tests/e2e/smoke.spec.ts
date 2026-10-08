import { test, expect, type Page } from '@playwright/test';

type Ent = { x: number; z: number; hp: number; pl: { dealt: number; lock: number } };
type Hook = { frames: number; tick: number; player: () => Ent | null };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __game?: Hook }).__game);
const player = (page: Page) => page.evaluate(() => (window as unknown as { __game: Hook }).__game.player());
const tick = (page: Page) => page.evaluate(() => (window as unknown as { __game: Hook }).__game.tick);

test('boots, starts a new game, and moves with keyboard and gamepad', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?debug=1&seed=smoke&lowfx=1');
  await expect.poll(async () => (await hook(page))?.frames ?? 0).toBeGreaterThan(5);

  await page.getByTestId('new-game').click();
  await page.getByTestId('class-berserker').click();
  await page.getByTestId('begin').click();
  // A new game opens in Gladsheim with the intro; read through it.
  await expect(page.locator('.dialogue')).toBeVisible();
  for (let i = 0; i < 6 && (await page.locator('.dialogue').count()); i++) await page.locator('.dialogue button').click();
  await expect(page.locator('.dialogue')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: { world: () => { room: { id: string } } } }).__game.world().room.id)).toBe('hub');
  // The rest of this run happens in the training yard behind the citadel.
  await page.evaluate(() => (window as unknown as { __game: { goto: (n: string) => void } }).__game.goto('training:training'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: { world: () => { room: { id: string } } } }).__game.world().room.id)).toBe('training');
  await page.locator('#view').focus();
  await expect.poll(() => tick(page)).toBeGreaterThan(10);

  // Keyboard: hold D for half a second, the player moves right.
  const before = (await player(page))!;
  await page.locator('#view').focus();
  // Software WebGL can run below 60 fps, so wait on sim ticks rather than wall time.
  const t0 = await tick(page);
  await page.keyboard.down('KeyD');
  await expect.poll(() => tick(page)).toBeGreaterThan(t0 + 30);
  await page.keyboard.up('KeyD');
  const after = (await player(page))!;
  expect(after.x - before.x).toBeGreaterThan(1.5);

  // Gamepad: a fake standard-mapping pad with the left stick pushed down.
  await page.evaluate(() => {
    const pad = {
      id: 'fake',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 1, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })),
      timestamp: performance.now(),
    };
    (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [pad];
  });
  const b2 = (await player(page))!;
  const t1 = await tick(page);
  await expect.poll(() => tick(page)).toBeGreaterThan(t1 + 30);
  const a2 = (await player(page))!;
  // Pillars may stop it; any clear southward movement proves the pad drives the player.
  expect(a2.z - b2.z).toBeGreaterThan(0.5);

  // Menus: K opens the character panel; spending a point works; Escape closes it.
  await page.evaluate(() => {
    (window as unknown as { __game: { world: () => { players: { character: { level: number } }[] } } }).__game.world().players[0]!.character.level = 3;
  });
  await page.keyboard.press('KeyK');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('button.node:has(.nname:text-is("Thick Hide"))').click();
  await expect(page.locator('button.node:has(.nname:text-is("Thick Hide"))')).toContainText('1/5');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#view').focus();

  // Combat: stand next to a dummy, lock on, and swing until damage lands.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: { world: () => { entities: { def: string; x: number; z: number }[] }; player: () => { x: number; z: number; fx: number; fz: number } } }).__game;
    const d = g.world().entities.find((e) => e.def === 'dummy')!;
    const p = g.player();
    p.x = d.x;
    p.z = d.z + 1.7;
    p.fx = 0;
    p.fz = -1;
  });
  await page.evaluate(() => (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => []);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await player(page))!.pl.lock).toBeGreaterThan(0);
  for (let i = 0; i < 20 && (await player(page))!.pl.dealt === 0; i++) {
    await page.mouse.click(480, 260);
    const t = await tick(page);
    await expect.poll(() => tick(page)).toBeGreaterThan(t + 8);
  }
  expect((await player(page))!.pl.dealt).toBeGreaterThan(0);

  // Loot: an item dropped at the player's feet is picked up and can be equipped from the Gear tab.
  await page.evaluate(() => (window as unknown as { __game: { drop: (r: string) => void } }).__game.drop('ascendant'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: { world: () => { players: { character: { inv: unknown[] } }[] } } }).__game.world().players[0]!.character.inv.length)).toBeGreaterThan(0);
  await page.keyboard.press('KeyI');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.bag-item').first().click();
  await page.getByRole('button', { name: 'Equip', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: { world: () => { players: { character: { equip: Record<string, { rarity: string } | null> } }[] } } }).__game.world().players[0]!.character.equip.melee?.rarity ?? (window as unknown as { __game: { world: () => { players: { character: { equip: Record<string, { rarity: string } | null> } }[] } } }).__game.world().players[0]!.character.equip.ranged?.rarity)).toBe('ascendant');
  await page.keyboard.press('Escape');
  await page.locator('#view').focus();

  // Enemies: travel to the arena, start an encounter, then die and come back.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: { goto: (n: string) => void } }).__game;
    g.goto('arena');
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: { world: () => { room: { id: string } } } }).__game.world().room.id)).toBe('arena');
  const enemies = () => page.evaluate(() => (window as unknown as { __game: { world: () => { entities: { kind: string }[] } } }).__game.world().entities.filter((e) => e.kind === 'enemy').length);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  await expect.poll(enemies, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyA');
  await page.evaluate(() => {
    const p = (window as unknown as { __game: { player: () => { hp: number } } }).__game.player();
    p.hp = 0;
  });
  await expect.poll(async () => (await player(page)) as unknown as { dead: boolean }).toMatchObject({ dead: true });
  await expect.poll(async () => ((await player(page)) as unknown as { dead: boolean }).dead, { timeout: 15_000 }).toBe(false);

  // Gamepad menu navigation: View opens the panel, D-pad moves focus, A activates, B closes.
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
    const pad = { id: 'fake', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [pad];
  });
  // Headless Chromium stops issuing animation frames while a paused page sits idle, so wait on
  // rendered frames (polling also wakes the page) rather than on wall time.
  const frameCount = () => page.evaluate(() => (window as unknown as { __game: { frames: number } }).__game.frames);
  const waitFrames = async (n: number) => {
    const f0 = await frameCount();
    await expect.poll(frameCount).toBeGreaterThan(f0 + n);
  };
  const padPress = async (i: number) => {
    await page.evaluate((b) => ((window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[b]!.pressed = true), i);
    await waitFrames(2);
    await page.evaluate((b) => ((window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[b]!.pressed = false), i);
    await waitFrames(2);
  };
  await padPress(8);
  await expect(page.getByRole('dialog')).toBeVisible();
  await padPress(13);
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBe('BUTTON');
  await padPress(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Saves: save, reload the page, Continue: level and gear come back.
  type G = { __game: { save: () => Promise<void>; world: () => { players: { character: { level: number; equip: Record<string, { rarity: string } | null> } }[] } } };
  const before3 = await page.evaluate(() => {
    const c = (window as unknown as G).__game.world().players[0]!.character;
    return { level: c.level, melee: c.equip.melee?.rarity, ranged: c.equip.ranged?.rarity };
  });
  await page.evaluate(() => (window as unknown as G).__game.save());
  await page.reload();
  await page.getByTestId('continue').click();
  await expect.poll(() => tick(page)).toBeGreaterThan(2);
  const after3 = await page.evaluate(() => {
    const c = (window as unknown as G).__game.world().players[0]!.character;
    return { level: c.level, melee: c.equip.melee?.rarity, ranged: c.equip.ranged?.rarity };
  });
  expect(after3).toEqual(before3);

  // A refused write is shown, with a way to export, never swallowed.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await page.evaluate(() => (window as unknown as G).__game.save());
  await expect(page.locator('.toast.error')).toContainText("Couldn't save");
  await expect(page.locator('.toast.error').getByRole('button', { name: 'Export now' })).toBeVisible();

  await page.screenshot({ path: 'test-results/smoke-game.png' });
  // The refused write logs nothing to the console; only real errors fail the run.
  expect(errors).toEqual([]);
});
