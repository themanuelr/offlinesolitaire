// Checks that Hint never suggests a pointless foundation-to-tableau move.
// Run: node tests/hint.test.js
import { DEALS } from '../js/deals.js';
import { deal } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { replay } from '../tools/replay.js';

let failures = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// Game 2058, Draw 3, after 93 moves (from a player's screenshot). The only way on is the 9♣
// back down onto the 10♥ so the 8♦ can move. Hint used to say "5♥ onto the 6♠" instead: the
// search took the 5♥ down and put it straight back up, which looks like an illegal move.
{
  const S = 0, H = 13, D = 26, C = 39;
  const c = (s, r) => s + r - 1, up = (x) => ({ c: x, up: true }), down = (x) => ({ c: x, up: false });
  const range = (s, n) => Array.from({ length: n }, (_, i) => c(s, i + 1));
  const game = {
    drawCount: 3, stock: [], waste: [c(D, 6), c(D, 5), c(D, 7)],
    foundations: [range(S, 3), range(H, 5), range(D, 3), range(C, 9)],
    tableau: [
      [c(S, 13), c(D, 12), c(S, 11), c(H, 10)].map(up),
      [c(C, 13), c(H, 12), c(C, 11), c(D, 10), c(S, 9), c(H, 8), c(S, 7), c(H, 6), c(S, 5)].map(up),
      [c(H, 13), c(S, 12), c(D, 11), c(C, 10), c(H, 9), c(S, 8), c(H, 7), c(S, 6)].map(up),
      [c(D, 13), c(C, 12), c(H, 11), c(S, 10), c(D, 9)].map(up),
      [], [],
      [down(c(S, 4)), down(c(D, 4)), up(c(D, 8))], // the two hidden cards are the 4♠ and 4♦
    ],
  };
  const r = solve(game);
  expect(r.solved, 'the position can be won');
  const m = r.path[0];
  expect(m.t === 'ft' && m.suit === 3 && m.to === 0, `hint is 9♣ onto 10♥ (got ${JSON.stringify(m)})`);
  replay(2058, 3, r.path, game);
  expect(true, 'the hinted solution plays out to a win');
}

// Solutions from the middle of many games still play out legally after the clean-up,
// and none of them takes a card off a foundation only to put it straight back.
{
  let checked = 0, bad = 0;
  for (const d of [3, 1]) {
    const list = DEALS[d];
    for (let i = 0; i < list.length; i += Math.floor(list.length / 25)) {
      const full = solve(deal(list[i], d), 20000);
      if (!full.solved) continue;
      for (const k of [20, 50, 80]) {
        if (k >= full.path.length) continue;
        const mid = replay(list[i], d, full.path.slice(0, k), null, false);
        const r = solve(mid, 20000);
        if (!r.solved) continue;
        try { replay(list[i], d, r.path, mid); } catch (e) { bad++; console.log(e.message); continue; }
        if (r.path[0].t === 'ft' && r.path[1]?.t === 'tf' && r.path[1].from === r.path[0].to) bad++;
        checked++;
      }
    }
  }
  expect(checked > 50 && bad === 0, `${checked} mid-game solutions replay legally (${bad} bad)`);
}

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log('hint tests passed');
