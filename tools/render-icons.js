// Renders the SVG icons to the PNG sizes Android needs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('icons/icon.svg', 'utf8');
const mask = readFileSync('icons/icon-maskable.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, size, out, bg] of [[svg, 192, 'icons/icon-192.png'], [svg, 512, 'icons/icon-512.png'], [mask, 512, 'icons/icon-maskable-512.png'], [svg, 180, 'icons/apple-touch-icon.png']]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
  await page.screenshot({ path: out, omitBackground: true });
}
await browser.close();
console.log('icons rendered');
