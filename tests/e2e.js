// Browser test on a tablet-sized screen. Needs the site served at BASE (default http://localhost:8080/).
// Run: npx http-server -p 8080 -c-1 & node tests/e2e.js
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE);
await page.waitForFunction(() => window.__solitaire);
check(await page.locator('.card').count() === 52, '52 cards on the table');

const g = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__solitaire.game)));
let s = await g();
check(s.drawCount === 3, 'Draw 3 is the default mode');
check(s.tableau.every((p, i) => p.length === i + 1) && s.stock.length === 24, 'standard Klondike deal');

// Tap the stock: three cards go to the waste.
const stockBox = await page.locator('.slot.stock').boundingBox();
await page.mouse.click(stockBox.x + stockBox.width / 2, stockBox.y + stockBox.height / 2);
s = await g();
check(s.waste.length === 3 && s.stock.length === 21 && s.moves === 1, 'tapping the stock draws 3 cards');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-draw.png` });

// Undo brings them back.
await page.click('#btn-undo');
s = await g();
check(s.waste.length === 0 && s.stock.length === 24, 'undo restores the stock');

// Drag a card with the mouse to a legal tableau spot, if one exists in this deal.
async function findTableauMove() {
  return page.evaluate(() => {
    const api = window.__solitaire; const game = api.game;
    for (let i = 0; i < 7; i++) {
      const p = game.tableau[i]; const idx = p.findIndex((x) => x.up);
      const dst = api.autoDestination({ area: 'tableau', pile: i, idx });
      if (dst && dst.area === 'tableau') return { card: p[idx].c, to: dst.pile };
    }
    return null;
  });
}
let mv = await findTableauMove();
for (let i = 0; i < 30 && !mv; i++) { await page.click('#btn-new'); mv = await findTableauMove(); }
if (mv) {
  await page.waitForTimeout(400); // let the deal animation settle
  const from = await page.locator(`.card[data-card="${mv.card}"]`).boundingBox();
  const target = await page.evaluate((to) => {
    const p = window.__solitaire.game.tableau[to];
    const el = document.querySelector(`.card[data-card="${p[p.length - 1].c}"]`);
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 };
  }, mv.to);
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  s = await g();
  check(s.tableau[mv.to].some((x) => x.c === mv.card), 'dragging a card onto a legal pile moves it');
} else check(false, 'found a deal with a tableau move to drag');

// Messages show above the cards, even over a long pile.
await page.evaluate(() => {
  const t = document.getElementById('toast');
  const card = document.querySelector(`.card[data-card="${window.__solitaire.game.tableau[3].at(-1).c}"]`).getBoundingClientRect();
  t.textContent = 'test'; t.classList.add('show'); t.style.pointerEvents = 'auto';
  t.style.bottom = `${innerHeight - card.bottom + card.height / 3}px`; // sit on top of a tableau card
});
await page.waitForTimeout(300);
const onTop = await page.evaluate(() => {
  const r = document.getElementById('toast').getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  document.getElementById('toast').style.cssText = '';
  return el && el.id === 'toast';
});
check(onTop, 'messages appear above the cards');

// Hint highlights something.
await page.click('#btn-hint');
await page.waitForSelector('.hint', { timeout: 8000 }).then(() => check(true, 'hint highlights a move'), () => check(false, 'hint highlights a move'));

// Win several deals end to end using the solver, in both modes.
for (const mode of [3, 3, 1]) {
  await page.evaluate((d) => window.__solitaire.newGame(d), mode);
  const solved = await page.evaluate(() => window.__solitaire.playSolution());
  await page.waitForTimeout(400);
  s = await g();
  check(solved && s.won, `draw ${mode} deal ${s.dealIndex + 1} played to a win`);
  await page.waitForSelector('#win[open]', { timeout: 4000 }).then(() => check(true, 'win dialog shows'), () => check(false, 'win dialog shows'));
  if (SHOTS && mode === 1) await page.screenshot({ path: `${SHOTS}/win.png` });
  await page.click('#btn-win-new');
  await page.waitForTimeout(300);
}

// Installability (manifest + icons + service worker) as Chrome sees it.
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
const cdp = await ctx.newCDPSession(page);
const inst = await cdp.send('Page.getInstallabilityErrors');
check(inst.installabilityErrors.length === 0, `installable as an app ${JSON.stringify(inst.installabilityErrors)}`);
const man = await cdp.send('Page.getAppManifest');
check(man.errors.length === 0, 'manifest parses without errors');

// Offline: cut the network and reload.
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__solitaire, null, { timeout: 10000 });
check(await page.locator('.card').count() === 52, 'loads and deals with the network off');
await page.click('#btn-new');
await page.click('#btn-hint');
await page.waitForSelector('.hint', { timeout: 8000 }).then(() => check(true, 'hint works offline'), () => check(false, 'hint works offline'));
await ctx.setOffline(false);

// Portrait layout fits on screen.
await page.setViewportSize({ width: 800, height: 1280 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => [...document.querySelectorAll('.card')].some((el) => el.getBoundingClientRect().right > innerWidth + 1));
check(!overflow, 'portrait layout fits the screen width');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
