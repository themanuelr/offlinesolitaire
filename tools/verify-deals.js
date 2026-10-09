// Re-solves a sample of the bank and replays it with the game rules.
import { DEALS } from '../js/deals.js';
import { deal } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { replay } from './replay.js';
let n = 0;
for (const d of [3, 1]) {
  const list = DEALS[d];
  for (let i = 0; i < list.length; i += Math.max(1, Math.floor(list.length / 40))) {
    const r = solve(deal(list[i], d), 100000);
    if (!r.solved) throw new Error(`draw ${d} seed ${list[i]} not solved`);
    replay(list[i], d, r.path); n++;
  }
}
console.log(`verified ${n} deals from the bank`);
