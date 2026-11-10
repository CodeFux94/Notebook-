// Renders the SVG icons to PNG. Dev-only helper, run: node tools/make-icons.mjs
// Needs Playwright with Chromium (not needed by the app itself).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// CommonJS resolution also honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)('playwright');
const dir = fileURLToPath(new URL('../icons/', import.meta.url));
const jobs = [
  ['icon.svg', 'favicon-32.png', 32],
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-full.svg', 'apple-touch-icon.png', 180], // iOS rounds corners itself: no transparency
  ['icon-full.svg', 'icon-152.png', 152],
  ['icon-full.svg', 'icon-167.png', 167],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = readFileSync(dir + src, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: dir + out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}
await browser.close();
