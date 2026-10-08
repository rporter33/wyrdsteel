import { test, expect, type Page } from '@playwright/test';

type Ent = { x: number; z: number; hp: number };
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
  expect(a2.z - b2.z).toBeGreaterThan(1.5);

  await page.screenshot({ path: 'test-results/smoke-game.png' });
  expect(errors).toEqual([]);
});
