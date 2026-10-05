// Replays a solver path with the game's own rules, to prove each deal is winnable in the app.
import { deal, drawStock, canGoToFoundation, canGoToTableau, isMovableRun, isWon, suitOf } from '../js/engine.js';

export function replay(seed, drawCount, path) {
  const g = deal(seed, drawCount);
  const fail = (msg) => { throw new Error(`seed ${seed}: ${msg}`); };
  const reveal = (p) => { if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true; };
  for (const m of path) {
    if (m.t === 'wf' || m.t === 'wt') {
      let guard = 200;
      while (g.waste.length !== m.w) { drawStock(g); if (!--guard) fail('waste position unreachable'); }
      const c = g.waste[g.waste.length - 1];
      if (m.t === 'wf') { if (!canGoToFoundation(g, c)) fail('bad wf'); g.foundations[suitOf(c)].push(g.waste.pop()); }
      else { if (!canGoToTableau(g.tableau[m.to], c)) fail('bad wt'); g.tableau[m.to].push({ c: g.waste.pop(), up: true }); }
    } else if (m.t === 'tf') {
      const p = g.tableau[m.from]; const top = p[p.length - 1];
      if (!top || !top.up || !canGoToFoundation(g, top.c)) fail('bad tf');
      g.foundations[suitOf(top.c)].push(p.pop().c); reveal(p);
    } else if (m.t === 'tt') {
      const p = g.tableau[m.from];
      if (!isMovableRun(p, m.idx) || !canGoToTableau(g.tableau[m.to], p[m.idx].c)) fail('bad tt');
      g.tableau[m.to].push(...p.splice(m.idx)); reveal(p);
    } else if (m.t === 'ft') {
      const f = g.foundations[m.suit]; const c = f[f.length - 1];
      if (!canGoToTableau(g.tableau[m.to], c)) fail('bad ft');
      g.tableau[m.to].push({ c: f.pop(), up: true });
    }
  }
  if (!isWon(g)) fail('not won at end of path');
  return true;
}
