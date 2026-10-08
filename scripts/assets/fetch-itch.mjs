// Downloads a free (CC0) pack from an itch.io creator page the way a person would: open the page,
// choose "No thanks, just take me to the downloads", click each file. Used for the Quaternius packs.
//   node scripts/assets/fetch-itch.mjs quaternius universal-animation-library .asset-cache/quaternius
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [creator, slug, out] = process.argv.slice(2);
if (!creator || !slug || !out) throw new Error('usage: fetch-itch.mjs <creator> <slug> <outDir>');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(`https://${creator}.itch.io/${slug}`);
await page.locator('.download_btn, a.buy_btn').first().click();
await page.locator('a.direct_download_btn').or(page.getByText('No thanks, just take me to the downloads')).first().click({ timeout: 15000 });
await page.waitForURL(/download/, { timeout: 20000 });
const buttons = page.locator('a.download_btn, .upload a.button');
for (let i = 0; i < (await buttons.count()); i++) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), buttons.nth(i).click()]);
  await dl.saveAs(`${out}/${dl.suggestedFilename()}`);
  console.log('saved', dl.suggestedFilename());
}
await browser.close();
