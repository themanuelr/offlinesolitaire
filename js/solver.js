// Klondike solver with full knowledge of every card (the standard definition of "solvable").
// Used offline to build the bank of solvable deals, and in a worker for the Hint button.
// Unlimited passes through the stock, drawing 1 or 3 cards at a time.

import { suitOf, rankOf, isRed } from './engine.js';

// Solver state:
//   piles[i]: cards bottom..top, down[i]: how many of them are face down
//   found[s]: number of cards on foundation of suit s
//   seq: the talon as one sequence (waste bottom..top, then stock in draw order), w = waste size
function fromGame(g) {
  const seq = g.waste.slice().concat(g.stock.slice().reverse());
  return {
    piles: g.tableau.map((p) => p.map((x) => x.c)),
    down: g.tableau.map((p) => p.filter((x) => !x.up).length),
    found: g.foundations.map((f) => f.length),
    seq, w: g.waste.length, d: g.drawCount,
  };
}

function copy(s) {
  return { piles: s.piles.map((p) => p.slice()), down: s.down.slice(), found: s.found.slice(), seq: s.seq.slice(), w: s.w, d: s.d };
}

function key(s) {
  const piles = s.piles.map((p, i) => s.down[i] + ':' + String.fromCharCode(...p.map((c) => c + 48))).sort();
  return s.found.join('') + '|' + s.w + '|' + String.fromCharCode(...s.seq.map((c) => c + 48)) + '|' + piles.join(',');
}

const fits = (c, top) => rankOf(top) === rankOf(c) + 1 && isRed(top) !== isRed(c);
const toFound = (s, c) => s.found[suitOf(c)] === rankOf(c) - 1;

function safeToFound(s, c) {
  const r = rankOf(c);
  if (r <= 2) return true;
  const red = isRed(c);
  for (let t = 0; t < 4; t++) {
    const tRed = t === 1 || t === 2;
    if (tRed !== red && s.found[t] < r - 1) return false;
  }
  return true;
}

// Waste sizes reachable by drawing (and recycling), including the current one.
function talonPositions(s) {
  const n = s.seq.length, out = [];
  const seen = new Set();
  let w = s.w;
  while (!seen.has(w)) {
    seen.add(w);
    out.push(w);
    if (n === 0) break;
    w = w === n ? 0 : Math.min(w + s.d, n);
  }
  return out;
}

function flip(s, i) {
  if (s.down[i] > 0 && s.down[i] === s.piles[i].length) s.down[i]--;
}

function apply(s, m) {
  const n = copy(s);
  switch (m.t) {
    case 'tf': { const c = n.piles[m.from].pop(); n.found[suitOf(c)]++; flip(n, m.from); break; }
    case 'wf': { const c = n.seq.splice(m.w - 1, 1)[0]; n.w = m.w - 1; n.found[suitOf(c)]++; break; }
    case 'wt': { const c = n.seq.splice(m.w - 1, 1)[0]; n.w = m.w - 1; n.piles[m.to].push(c); break; }
    case 'tt': { const run = n.piles[m.from].splice(m.idx); n.piles[m.to].push(...run); flip(n, m.from); break; }
    case 'ft': { const c = m.suit * 13 + n.found[m.suit] - 1; n.found[m.suit]--; n.piles[m.to].push(c); break; }
  }
  return n;
}

// Play every "safe" foundation move; returns the new state and the moves made.
function autoPlay(s, path) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < 7; i++) {
      const p = s.piles[i];
      if (p.length && toFound(s, p[p.length - 1]) && safeToFound(s, p[p.length - 1])) {
        const m = { t: 'tf', from: i }; s = apply(s, m); path.push(m); changed = true;
      }
    }
    if (s.w > 0) {
      const c = s.seq[s.w - 1];
      if (toFound(s, c) && safeToFound(s, c)) {
        const m = { t: 'wf', w: s.w }; s = apply(s, m); path.push(m); changed = true;
      }
    }
  }
  return s;
}

function moves(s) {
  const first = [], reveal = [], talon = [], other = [], last = [];
  // Tableau to foundation.
  for (let i = 0; i < 7; i++) {
    const p = s.piles[i];
    if (p.length && toFound(s, p[p.length - 1])) first.push({ t: 'tf', from: i });
  }
  // Tableau to tableau.
  for (let i = 0; i < 7; i++) {
    const p = s.piles[i];
    for (let idx = s.down[i]; idx < p.length; idx++) {
      const c = p[idx];
      const whole = idx === s.down[i];
      if (!whole && !toFound(s, p[idx - 1])) continue;
      let emptyTried = false;
      for (let j = 0; j < 7; j++) {
        if (j === i) continue;
        const q = s.piles[j];
        if (q.length === 0) {
          if (rankOf(c) !== 13 || emptyTried || (whole && idx === 0)) continue;
          emptyTried = true;
        } else if (!fits(c, q[q.length - 1])) continue;
        const m = { t: 'tt', from: i, idx, to: j };
        (whole && idx > 0 ? reveal : other).push(m);
      }
    }
  }
  // Talon to foundation / tableau.
  for (const w of talonPositions(s)) {
    if (w === 0) continue;
    const c = s.seq[w - 1];
    if (toFound(s, c)) first.push({ t: 'wf', w });
    let emptyTried = false;
    for (let j = 0; j < 7; j++) {
      const q = s.piles[j];
      if (q.length === 0) {
        if (rankOf(c) !== 13 || emptyTried) continue;
        emptyTried = true;
      } else if (!fits(c, q[q.length - 1])) continue;
      talon.push({ t: 'wt', w, to: j });
    }
  }
  // Foundation back to tableau.
  for (let suit = 0; suit < 4; suit++) {
    if (s.found[suit] < 2) continue;
    const c = suit * 13 + s.found[suit] - 1;
    for (let j = 0; j < 7; j++) {
      const q = s.piles[j];
      if (q.length && fits(c, q[q.length - 1])) last.push({ t: 'ft', suit, to: j });
    }
  }
  reveal.sort((a, b) => s.down[b.from] - s.down[a.from]);
  return first.concat(reveal, talon, other, last);
}

const done = (s) => s.found.every((f) => f === 13);

// Returns { solved: true, path } | { solved: false, complete } where complete means
// the search space was exhausted (definitely unsolvable under the solver's move set).
export function solve(game, maxNodes = 200000) {
  let nodes = 0;
  const seen = new Set();
  const path = [];
  let aborted = false;

  function dfs(s) {
    const mark = path.length;
    s = autoPlay(s, path);
    if (done(s)) return true;
    const k = key(s);
    if (seen.has(k)) { path.length = mark; return false; }
    seen.add(k);
    if (++nodes > maxNodes) { aborted = true; path.length = mark; return false; }
    for (const m of moves(s)) {
      path.push(m);
      if (dfs(apply(s, m))) return true;
      path.pop();
      if (aborted) break;
    }
    path.length = mark;
    return false;
  }

  const ok = dfs(fromGame(game));
  return ok ? { solved: true, path, nodes } : { solved: false, complete: !aborted, nodes };
}
