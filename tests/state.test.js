// Checks the dev mode state string, and that the solver never calls a winnable position lost.
// Run: node tests/state.test.js
import { readFileSync } from 'node:fs';
import { DEALS } from '../js/deals.js';
import { deal, drawStock, encodeState, decodeState } from '../js/engine.js';
import { solve, reset } from '../js/solver.js';
import { VERSION } from '../js/version.js';
import { replay } from '../tools/replay.js';

let failures = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// The menu shows the same version the service worker caches under.
{
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  expect(sw.includes(`const VERSION = '${VERSION}';`), `js/version.js and sw.js agree on ${VERSION}`);
}

// The state string round-trips and is digits and dots only.
{
  const g = deal(DEALS[3][2952], 3);
  for (let i = 0; i < 5; i++) drawStock(g);
  g.foundations[0].push(0); // a non-empty foundation (A♠; the string does not check legality)
  g.tableau[0] = [];
  const str = encodeState(g, 2953);
  expect(/^[\d.]+$/.test(str), `state string is digits and dots (${str.length} characters)`);
  const back = decodeState(str);
  expect(back.gameNo === 2953 && encodeState(back.game, 2953) === str, 'state string decodes back to the same position');
  expect(JSON.stringify(back.game.tableau) === JSON.stringify(g.tableau), 'tableau survives, face-down cards included');
}

// Game 2953, Draw 3, from the start: Hint says draw, and each draw keeps the game winnable.
// The solver used to send the waste's top card home whenever that was "safe", which in Draw 3
// shifts which cards later draws reach, so after the third draw (A♠ on top) it called the
// game lost.
{
  const g = deal(DEALS[3][2952], 3);
  let ok = true;
  for (let k = 0; k < 9; k++) {
    reset();
    const r = solve(g, 80000);
    if (!r.solved) { ok = false; console.log(`  after ${k} draws: ${r.complete ? 'lost' : 'undecided'}`); }
    else replay(2953, 3, r.path, g);
    drawStock(g);
  }
  expect(ok, 'game 2953 stays winnable through a full pass of the stock');
}

// Found by random play: positions the old solver proved lost but that can be won.
for (const [name, str] of [
  ['game 499, 6 moves in', '1.3.0.00000000.261907513829224933.412813143044010439023440323547.005.0255036.1464316.2451827.43100170320.5481208104221.609371106232415'],
]) {
  reset();
  const { game } = decodeState(str);
  const r = solve(game, 650000);
  expect(r.solved, `${name} is winnable`);
  if (r.solved) replay(0, game.drawCount, r.path, game);
}

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log('state tests passed');
