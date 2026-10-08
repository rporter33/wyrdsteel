import { expect, test } from '@playwright/test';

// The game installs itself on the first visit; after that it opens and plays with no network.
test('installs on first visit, then boots and plays offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug=1');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The page that installed the worker is claimed by it; wait for that before cutting the cable.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await page.getByTestId('new-game').click();
  await page.getByTestId('begin').click();
  const frames = () => page.evaluate(() => (window as unknown as { __game: { frames: number } }).__game.frames);
  const f0 = await frames();
  await expect.poll(frames).toBeGreaterThan(f0 + 10);
  // The debug autopilot lives in a lazily loaded chunk: it must be in the cache too.
  await page.evaluate(() => (window as unknown as { __game: { autopilot: (on: boolean) => Promise<void> } }).__game.autopilot(false));
  expect(errors).toEqual([]);
});
