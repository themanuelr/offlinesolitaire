// Looks at a position copied with dev mode's copy button.
// Run: node tools/state.js "<state string>" [maxNodes]
import { decodeState, cardName } from '../js/engine.js';
import { solve } from '../js/solver.js';

const [str, max] = process.argv.slice(2);
const { game, gameNo } = decodeState(str);
const names = (a) => a.map(cardName).join(' ') || '-';
console.log(`Draw ${game.drawCount} · Game ${gameNo}`);
console.log('foundations', game.foundations.map((f) => f.length).join(' '));
console.log('waste', names(game.waste));
console.log('stock (top last)', names(game.stock));
game.tableau.forEach((p, i) => console.log(`pile ${i + 1}`, p.map((x) => (x.up ? cardName(x.c) : `[${cardName(x.c)}]`)).join(' ') || '-'));
for (const n of [80000, Number(max) || 2000000]) {
  const t = Date.now();
  const r = solve(game, n);
  const verdict = r.solved ? `winnable, first move ${JSON.stringify(r.path[0])}` : r.complete ? 'proven lost' : 'undecided';
  console.log(`solver ${n} nodes: ${verdict} (${r.nodes} nodes, ${Date.now() - t} ms)`);
}
