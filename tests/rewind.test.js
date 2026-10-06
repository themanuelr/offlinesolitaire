// Checks that "go back to the last winnable position" undoes only the losing move.
// Run: node tests/rewind.test.js
import { DEALS } from '../js/deals.js';
import { deal, drawStock, suitOf } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { findLastWinnable } from '../js/rewind.js';

let failures = 0;
const expect = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// A solver timeout in the middle of the history must not count as "lost".
{
  const results = ['W', 'W', 'W', '?', 'W', '?', 'W', 'W', 'L'];
  const fake = async (i) => (results[i] === 'W' ? { solved: true } : { solved: false, complete: results[i] === 'L' });
  const r = await findLastWinnable(results.map((_, i) => i), fake);
  expect(r && r.index === 7 && r.sure, 'timeouts earlier in the history do not cause a long rewind');
  const r2 = await findLastWinnable([0, 1, 2], async (i) => (i === 2 ? { solved: false, complete: false } : { solved: true }));
  expect(r2 && r2.index === 2 && !r2.sure, 'an undecided position is kept, not rewound past');
  expect(await findLastWinnable([0, 1], async () => ({ solved: false, complete: true })) === null, 'reports when nothing is winnable');
}

// Game 2411, Draw 3, played the way a person might (not following hints). Early on the
// solver can't settle several of these positions within its budget, even though they are
// winnable (later positions in the same game are). The player then makes a losing move.
{
  const MOVES = [
    { t: 'tt', from: 0, idx: 0, to: 2 }, { t: 'tt', from: 1, idx: 1, to: 5 }, { t: 'draw' }, { t: 'wt', to: 5 },
    { t: 'draw' }, { t: 'wt', to: 0 }, { t: 'draw' }, { t: 'tt', from: 5, idx: 5, to: 0 }, { t: 'draw' },
    { t: 'tf', from: 5 }, { t: 'tt', from: 5, idx: 3, to: 0 }, { t: 'draw' }, { t: 'draw' }, { t: 'draw' },
    { t: 'draw' }, { t: 'draw' }, { t: 'draw' }, { t: 'draw' }, { t: 'draw' }, { t: 'draw' },
  ];
  const reveal = (p) => { if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true; };
  const play = (g, m) => {
    if (m.t === 'draw') return drawStock(g);
    if (m.t === 'wt') return g.tableau[m.to].push({ c: g.waste.pop(), up: true });
    const p = g.tableau[m.from];
    if (m.t === 'tf') { g.foundations[suitOf(p[p.length - 1].c)].push(p.pop().c); return reveal(p); }
    g.tableau[m.to].push(...p.splice(m.idx)); reveal(p);
  };
  let g = deal(DEALS[3][2410], 3);
  const history = [];
  for (const m of MOVES) { history.push(JSON.stringify(g)); play(g, m); }
  history.push(JSON.stringify(g)); // the position just before the losing move

  const check = async (snap) => solve(JSON.parse(snap), 150000);
  const undecided = (await Promise.all(history.map(check))).filter((r) => !r.solved && !r.complete).length;
  expect(undecided > 0, `the solver times out on ${undecided} winnable positions of this game`);
  const r = await findLastWinnable(history, check);
  const back = r ? history.length - r.index : 'none';
  expect(r && r.sure && back === 1, `rewind goes back 1 move (went back ${back})`);
}

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log('rewind tests passed');
