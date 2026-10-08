import { test, expect, type Page } from '@playwright/test';

type Hook = { frames: number };
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __game: Hook }).__game);

test('boots without console errors and renders frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?debug=1');
  await expect.poll(async () => (await hook(page))?.frames ?? 0).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
